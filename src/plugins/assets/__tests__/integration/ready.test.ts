/**
 * @file assets plugin — `ready` and `warm` on the real app (F52, F60): the real time, lifecycle, model, flow, world,
 * renderer and assets, the renderer drawing on the fake page and fake Pixi, the files coming from the fake io. A node
 * rests on the load of a bundle and stays answerable, and moves on once the bundle's textures went to the GPU, one a
 * drawn frame (A Memory Missing: the memory screen's 6 cold textures cost its show frame 55 ms on the A26).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, ready, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  createFakePixi,
  type FakeGpuTextureSystem,
  FakeTexture
} from "../../../renderer/__tests__/fake-pixi";
import { worldPlugin } from "../../../world";
import { assetsPlugin } from "../../index";
import type { Manifest, Texture } from "../../types";
import { createFakeIo, type FakeIo } from "../unit/mock-assets";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The memory's bundle: two pictures of 128×128. */
const manifest: Manifest = {
  version: 1,
  bundles: {
    "ep01.memory": {
      feature: "ep01",
      tier: "lazy",
      mb: 0.126,
      files: ["room", "photo"].map(name => ({
        key: `ep01.${name}`,
        path: `features/ep01/assets/${name}.png`,
        width: 128,
        height: 128,
        mb: 0.063
      }))
    }
  }
};

// The recipe of the assets README: a transit node asks, a rest node waits for `ready` and still answers Back.
const home = defineNode({ rest: true, outcomes: { open: type() } });
const resume = defineNode({
  outcomes: { wait: type(), open: type() },
  run: async ({ fx, out }) => {
    if ((await fx(ready("ep01.memory"))) === false) return out.wait();

    return out.open();
  }
});
const wait = defineNode({
  rest: true,
  inbox: ["ready"],
  outcomes: { ready: type(), back: type() }
});
const memory = defineNode({ rest: true, outcomes: { leave: type() } });
const main = defineFlow("main", {
  nodes: { home, resume, wait, memory },
  start: "home",
  edges: {
    home: { open: "resume" },
    resume: { wait: "wait", open: "memory" },
    wait: { ready: "resume", back: "home" },
    memory: { leave: "home" }
  }
});
const game = defineFeature("ep01", { flows: [main] });

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
 * Starts the game on `home`, its renderer drawing on demand on the fake page.
 *
 * @returns The app, the io, the fake GPU's textures and the frame driver.
 */
async function startGame() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const io = pixiIo();
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, game],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0,
        onDemand: true
      },
      assets: { manifest, io, preloadDepth: 0 }
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

  return { app, io, gpu: (pixi.last().renderer.texture as FakeGpuTextureSystem).made, frames };
}

describe("assets integration: ready and warm (F52, F60)", () => {
  // Bug: the node awaits the load inside its run, so Back does nothing until the memory's pictures arrived.
  it("rests on wait while the load runs, answers Back there, and takes ready once the textures are on the GPU", async () => {
    const { app, io, gpu, frames } = await startGame();

    io.control.gated = true;

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await frames(1);

    expect(app.flow.state().path).toBe("wait");

    // Back cancels; the load goes on as shared work.
    expect(app.flow.gate.answer({ intent: "back" })).toBe(true);
    await frames(1);

    expect(app.flow.state().path).toBe("home");

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await frames(1);

    expect(app.flow.state().path).toBe("wait");

    io.releaseAll();
    await frames(1);

    // Loaded, one of the two pictures uploaded: the node still rests.
    expect(app.assets.isLoaded("ep01.memory")).toBe(true);
    expect(gpu.size).toBe(1);
    expect(app.flow.state().path).toBe("wait");

    await frames(1);

    expect(gpu.size).toBe(2);
    expect(app.flow.state().path).toBe("memory");
  });

  // Bug: warm resolves when the bundle is loaded, before the frames put its textures on the GPU.
  it("resolves warm only after the real frames uploaded every texture of the bundle, one a drawn frame", async () => {
    const { app, gpu, frames } = await startGame();
    let warmed = false;

    app.assets.warm("ep01.memory").then(() => {
      warmed = true;
    });
    await frames(1);

    expect(gpu.size).toBe(1);
    expect(warmed).toBe(false);

    await frames(1);

    expect(gpu.size).toBe(2);
    expect(warmed).toBe(true);
  });
});
