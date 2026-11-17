import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, screen, type } from "../../../../index";
import { defineScene } from "../../../scenes/define";
import { assetsPlugin } from "../../index";
import type { Events, Manifest } from "../../types";
import { createFakeIo } from "../unit/mock-assets";

// ---------------------------------------------------------------------------
// Integration (F198 row 3): the real time, flow, world, scenes, renderer and assets plugins over the fake io. A game
// with two scenes, alpha and beta, where beta is not a preload neighbour of alpha (`preloadDepth: 0`): once beta is
// mounted nothing draws and nothing keeps the bundle of alpha, so `releaseUndrawnS` takes it; going back costs a load
// that the `load` stage waits for.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

const manifest: Manifest = {
  version: 1,
  bundles: {
    alpha: {
      feature: "pair",
      tier: "scene",
      mb: 0.063,
      files: [
        {
          key: "pair.alpha",
          path: "features/pair/assets/alpha.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    },
    beta: {
      feature: "pair",
      tier: "scene",
      mb: 0.063,
      files: [
        {
          key: "pair.beta",
          path: "features/pair/assets/beta.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    }
  }
};

const alpha = defineNode({ rest: true, scene: "alpha", outcomes: { go: type() } });
const beta = defineNode({ rest: true, scene: "beta", outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { alpha, beta },
  start: "alpha",
  edges: { alpha: { go: "beta" }, beta: { back: "alpha" } }
});
const pair = defineFeature("pair", {
  flows: [main],
  scenes: [
    defineScene("alpha", { bundle: "alpha", layers: {}, projections: [] }),
    defineScene("beta", { bundle: "beta", layers: {}, projections: [] })
  ]
});

/** What the probe plugin heard from `assets`. */
const heard: {
  loaded: Events["assets:bundle-loaded"][];
  unloaded: Events["assets:bundle-unloaded"][];
} = { loaded: [], unloaded: [] };

const probePlugin = createPlugin("undrawnProbe", {
  depends: [assetsPlugin],
  hooks: () => ({
    "assets:bundle-loaded": (payload: Events["assets:bundle-loaded"]) => {
      heard.loaded.push(payload);
    },
    "assets:bundle-unloaded": (payload: Events["assets:bundle-unloaded"]) => {
      heard.unloaded.push(payload);
    }
  })
});

/**
 * Gives the microtask queue to the loop, the way a test waits without a timer.
 */
async function turns(): Promise<void> {
  for (let index = 0; index < 80; index += 1) await Promise.resolve();
}

/**
 * Starts the game on alpha with the release set to 5 game seconds.
 *
 * @returns The app, the fake io and the helpers that move the game.
 */
async function startPair() {
  heard.loaded.length = 0;
  heard.unloaded.length = 0;

  const io = createFakeIo();
  const app = createApp({
    plugins: [...screen, pair, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 },
      assets: { manifest, io, preloadDepth: 0, releaseUndrawnS: 5 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of the given length, the runner given its turn before each.
   *
   * @param count - How many frames.
   * @param ms - The length of each, in game milliseconds.
   */
  const frames = async (count: number, ms: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      await turns();
      app.time.step(ms);
    }

    await turns();
  };

  /**
   * Steps frames until a scene is the mounted one.
   *
   * @param scene - The scene's id.
   */
  const untilScene = async (scene: string): Promise<void> => {
    for (let frame = 0; frame < 60 && app.scenes.current() !== scene; frame += 1) {
      await frames(1, 16);
    }

    expect(app.scenes.current()).toBe(scene);
  };

  await untilScene("alpha");

  return { app, io, frames, untilScene };
}

describe("F198: a bundle nothing draws and nothing keeps leaves after N game seconds", () => {
  // Bug: the pass is not wired to the frame clock, or releases what the scene still names: the bundle of alpha stays for
  // the session (the 236 MB loaded against 85 MB drawn of the A26), or goes while alpha is on screen.
  it("unloads the bundle of the scene left, and not before N seconds after it stopped being kept", async () => {
    const { app, frames, untilScene } = await startPair();

    // Alpha is mounted: its bundle is named by the scene, however many seconds pass.
    await frames(8, 1000);

    expect(app.assets.isLoaded("alpha")).toBe(true);

    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await untilScene("beta");
    await frames(3, 1000);

    expect(app.assets.isLoaded("alpha")).toBe(true);

    await frames(4, 1000);

    expect(app.assets.isLoaded("alpha")).toBe(false);
    expect(heard.unloaded).toEqual([
      {
        bundle: "alpha",
        tier: "scene",
        mb: 0.063,
        reason: "undrawn",
        keys: ["pair.alpha"]
      }
    ]);
    // The scene on screen keeps its own.
    expect(app.assets.isLoaded("beta")).toBe(true);

    await app.stop();
  });

  // Bug: the return to a released scene draws it missing: the `load` stage does not wait for the bundle, and the scene
  // shows placeholders until the files land.
  it("costs a load on the way back, and the node is not entered before it lands", async () => {
    const { app, io, frames, untilScene } = await startPair();

    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await untilScene("beta");
    await frames(8, 1000);

    expect(app.assets.isLoaded("alpha")).toBe(false);

    // The files of alpha are on the way: the answer is taken, the scene stays beta, nothing is drawn missing.
    io.control.gated = true;
    expect(app.flow.gate.answer({ intent: "back" })).toBe(true);
    await frames(20, 16);

    expect(app.scenes.current()).toBe("beta");
    expect(app.assets.isLoaded("alpha")).toBe(false);

    io.control.gated = false;
    io.releaseAll();
    await untilScene("alpha");

    expect(app.assets.isLoaded("alpha")).toBe(true);
    expect(
      heard.loaded.filter(entry => entry.bundle === "alpha").map(entry => entry.reason)
    ).toEqual(["enter", "enter"]);

    await app.stop();
  });
});
