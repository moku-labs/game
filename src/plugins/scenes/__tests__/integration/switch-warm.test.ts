/**
 * @file scenes plugin — a live switch puts the textures of the new scene on the GPU before it mounts (F61): the real
 * screen plugins, the renderer drawing on demand on the fake page and fake Pixi, the files coming from the fake io.
 * A Memory Missing on the A26: the first switch from the ward to the board took one frame of 284 ms with 8 uploads in
 * it; with the uploads spread over the frames before, the old scene still on screen, the switch frame uploads nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createPlugin, defineGame, screen, type } from "../../../../index";
import { createFakeIo, type FakeIo } from "../../../assets/__tests__/unit/mock-assets";
import type { Manifest, Texture } from "../../../assets/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  createFakePixi,
  type FakeGpuTextureSystem,
  FakeTexture
} from "../../../renderer/__tests__/fake-pixi";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * Builds a file of 128×128.
 *
 * @param name - The picture name.
 * @returns The manifest file entry.
 */
function fileOf(name: string) {
  return {
    key: `ep01.${name}`,
    path: `features/ep01/assets/${name}.png`,
    width: 128,
    height: 128,
    mb: 0.063
  };
}

/** The ward's bundle has one picture; the board's has three, each a source of its own. */
const manifest: Manifest = {
  version: 1,
  bundles: {
    "ep01.ward": { feature: "ep01", tier: "lazy", mb: 0.063, files: [fileOf("bed")] },
    "ep01.board": {
      feature: "ep01",
      tier: "lazy",
      mb: 0.189,
      files: ["table", "photo", "note"].map(name => fileOf(name))
    }
  }
};

const wardScene = defineScene("ward", { bundle: "ep01.ward", layers: {}, projections: [] });
const boardScene = defineScene("board", { bundle: "ep01.board", layers: {}, projections: [] });

const ward = defineNode({ rest: true, scene: "ward", outcomes: { open: type() } });
const board = defineNode({ rest: true, scene: "board", outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { ward, board },
  start: "ward",
  edges: { ward: { open: "board" }, board: { back: "ward" } }
});
const game = defineFeature("ep01", { flows: [main], scenes: [wardScene, boardScene] });

/** The frame each `scenes:changed` was heard in, by the scene it went to. */
const switched: Array<{ to: string; frame: number }> = [];
const clock = { frame: 0 };

const probePlugin = createPlugin("switchWarmProbe", {
  depends: [scenesPlugin],
  hooks: () => ({
    "scenes:changed": (payload: { to: string }) => {
      switched.push({ to: payload.to, frame: clock.frame });
    }
  })
});

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.unstubAllGlobals();
});

/**
 * The fake io with textures the fake Pixi can upload: each image gets a source of its own.
 *
 * @returns The io.
 */
function pixiIo(): FakeIo {
  const io = createFakeIo();

  io.createTexture = (): Texture =>
    new FakeTexture({ source: { width: 128, height: 128, destroyed: false } }) as never;

  return io;
}

/**
 * Starts the game on the ward, its renderer drawing on demand on the fake page.
 *
 * @returns The app, the fake GPU's textures and a frame driver that records the GPU textures after each frame.
 */
async function startGame() {
  installFakeDom({ width: 1080, height: 1920 });
  switched.length = 0;
  clock.frame = 0;

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, game, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0,
        onDemand: true
      },
      assets: { manifest, io: pixiIo(), preloadDepth: 0 }
    }
  });

  await app.start();
  running.push(app);
  app.flow.run().catch(() => undefined);

  const gpu = (): number => (pixi.last().renderer.texture as FakeGpuTextureSystem).made.size;
  /** The GPU textures after each stepped frame. */
  const made: number[] = [];

  /**
   * Gives the runner and the loads their turn, then steps frames of 16 ms.
   *
   * @param count - How many frames.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      clock.frame += 1;
      app.time.step(16);
      made.push(gpu());
    }

    for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
  };

  await frames(2);

  return { app, made, frames };
}

describe("scenes integration: a live switch uploads the new scene's textures first (F61)", () => {
  // Bug: the switch awaits only the load, so the board mounts with its three textures cold and its first frame
  // uploads all of them at once.
  it("mounts the board only after the frames uploaded its textures one a frame, and its frames upload nothing", async () => {
    const { app, made, frames } = await startGame();
    const before = made.length;

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await frames(6);

    const run = made.slice(before);
    const at = switched.find(entry => entry.to === "board")?.frame;

    expect(app.flow.state().path).toBe("board");
    // One upload a drawn frame, the budget of `renderer.uploads: 1`, while the ward is still mounted.
    // The ward's picture went up at the start.
    expect(run.slice(0, 3)).toEqual([2, 3, 4]);
    expect(at).toBeDefined();
    // The board mounts after the third upload: no frame from its mount on uploads anything.
    expect(at).toBeGreaterThanOrEqual(before + 3);
    expect(made.slice((at ?? 0) - 1)).toEqual(made.slice((at ?? 0) - 1).map(() => 4));
  });

  // Bug: the switch waits a frame or more beyond a plain switch for textures that are on the GPU already.
  it("switches back to a board whose textures are uploaded at the speed of a plain switch", async () => {
    const { app, frames } = await startGame();

    app.flow.gate.answer({ intent: "open" });
    await frames(6);
    app.flow.gate.answer({ intent: "back" });
    await frames(3);

    const left = clock.frame;

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await frames(3);

    const back = switched.findLast(entry => entry.to === "board")?.frame;

    expect(app.flow.state().path).toBe("board");
    // A plain switch (slice R): the frame after the answer draws the reaction, the next one builds (the renderer makes
    // the views aside in its pass), and the one after swaps.
    expect(back).toBe(left + 3);
  });
});
