/**
 * @file assets plugin — a `release: "leave"` bundle a node rests on through `ready` (F190, A Memory Missing's memory:
 * `ui.memory`, tier `scene`, of the feature `shared`). The transit node `show` asks `ready(["ui.memory"])`, gets
 * `false` and rests on `wait` until the inbox event `ready`. Entering the node after that rest ran the release the rest
 * marked: nothing held the bundle yet (no mounted scene names it, its feature has no node on the stack), so it went,
 * `show` asked again, and the two nodes cycled forever. With files served at once this never left the microtask queue
 * and hung the game's headless runs; in a browser it fetches and frees the memory's art in a loop.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createPlugin, defineGame, ready, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { defineScene } from "../../../scenes/define";
import { worldPlugin } from "../../../world";
import { assetsPlugin } from "../../index";
import type { Events, Manifest, Texture } from "../../types";
import { createFakeIo, type FakeIo } from "../unit/mock-assets";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * The memory screen's own art: a scene bundle of the shared layer, released on leave, as the game's `ui.memory`. It
 * has no files, so its load ends within a few microtasks, before the flow enters `wait`: the game's headless io serves
 * its files that fast too.
 */
/**
 * Builds the manifest.
 *
 * @param memoryMb - What `ui.memory` counts against the texture budget.
 * @returns The manifest.
 */
function manifestOf(memoryMb: number): Manifest {
  return {
    version: 1,
    bundles: {
      ward: { feature: "story", tier: "scene", mb: 0, files: [] },
      "ui.memory": { feature: "shared", tier: "scene", release: "leave", mb: memoryMb, files: [] }
    }
  };
}

/** How many unloads of `ui.memory` mean the loop: the probe throws there, so a regression fails instead of hanging. */
const LOOP = 20;

// The game's panorama: `show` asks for the pictures and rests on `wait` until they are there.
const ward = defineNode({ rest: true, scene: "ward", outcomes: { connect: type() } });
const show = defineNode({
  outcomes: { wait: type(), shown: type() },
  run: async ({ fx, out }) => {
    if ((await fx(ready(["ui.memory"]))) === false) return out.wait();

    return out.shown();
  }
});
const wait = defineNode({
  rest: true,
  inbox: ["ready"],
  outcomes: { ready: type(), back: type() }
});
const panorama = defineNode({ rest: true, scene: "memory", outcomes: { close: type() } });
const main = defineFlow("main", {
  nodes: { ward, show, wait, panorama },
  start: "ward",
  edges: {
    ward: { connect: "show" },
    show: { wait: "wait", shown: "panorama" },
    wait: { ready: "show", back: "ward" },
    panorama: { close: "ward" }
  }
});
const story = defineFeature("story", {
  flows: [main],
  scenes: [
    defineScene("ward", { bundle: "ward", layers: {}, projections: [] }),
    defineScene("memory", { bundle: "ui.memory", layers: {}, projections: [] })
  ]
});

/** Why `ui.memory` was unloaded, each time, in order. */
const unloads: string[] = [];

const probePlugin = createPlugin("readyLeaveProbe", {
  depends: [assetsPlugin],
  hooks: () => ({
    "assets:bundle-unloaded": ({ bundle, reason }: Events["assets:bundle-unloaded"]) => {
      if (bundle !== "ui.memory") return;

      unloads.push(reason);
      // A loop that never leaves the microtask queue starves the test's timeout: end it here.
      if (unloads.length === LOOP) throw new Error("ui.memory released and loaded again in a loop");
    }
  })
});

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  unloads.length = 0;
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
 * Starts the game on the ward, its renderer drawing on demand on the fake page, every file served at once.
 *
 * @param textureBudgetMb - The texture budget.
 * @param memoryMb - What `ui.memory` costs against it.
 * @returns The app and the frame driver.
 */
async function startGame(textureBudgetMb = 250, memoryMb = 0) {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, probePlugin, story],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0,
        onDemand: true
      },
      assets: {
        manifest: manifestOf(memoryMb),
        io: pixiIo(),
        preloadDepth: 0,
        textureBudgetMb
      }
    }
  });
  await app.start();
  running.push(app);
  app.flow.run().catch(() => undefined);

  /**
   * Gives the runner and the loads their turn, then steps frames of 16 ms.
   *
   * @param count - How many frames.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }

    for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
  };

  await frames(2);

  return { app, frames };
}

describe("assets integration: a leave bundle a node rests on through ready (F190)", () => {
  // Bug: the release the wait's rest marked let the bundle go as `show` came back, so show and wait cycled forever.
  it("keeps the bundle the ready asked for through the rest, and the node it rested for moves on", async () => {
    const { app, frames } = await startGame();

    expect(app.flow.gate.answer({ intent: "connect" })).toBe(true);
    await frames(6);

    expect(app.flow.state().path).toBe("panorama");
    expect(app.assets.isLoaded("ui.memory")).toBe(true);
    expect(unloads).toEqual([]);
  });

  // Bug: the hold of a `ready` outlived the wait, so a leave bundle nobody names stayed loaded under every screen after.
  it("ends the hold once ready answered true: the next release after a rest lets the bundle go", async () => {
    const { app, frames } = await startGame();

    expect(app.flow.gate.answer({ intent: "connect" })).toBe(true);
    await frames(6);
    expect(app.flow.state().path).toBe("panorama");

    // Back on the ward, then into the memory again: entering `show` after the ward's rest releases what nobody holds.
    expect(app.flow.gate.answer({ intent: "close" })).toBe(true);
    await frames(2);
    expect(app.flow.gate.answer({ intent: "connect" })).toBe(true);
    await frames(6);

    expect(unloads).toEqual(["leave"]);
    expect(app.flow.state().path).toBe("panorama");
    expect(app.assets.isLoaded("ui.memory")).toBe(true);
  });

  // Bug: over the budget, the pass of the wait's rest evicted the bundle the node rests on, and show and wait cycled.
  it("keeps the bundle the ready asked for from the budget pass of the rest", async () => {
    const { app, frames } = await startGame(0.05, 0.1);

    expect(app.flow.gate.answer({ intent: "connect" })).toBe(true);
    await frames(6);

    // The pass of the panorama's own rest still runs before its load stage pins the bundle, which brings it back.
    expect(app.flow.state().path).toBe("panorama");
    expect(app.assets.isLoaded("ui.memory")).toBe(true);
    expect(unloads).toEqual(["budget"]);
  });
});
