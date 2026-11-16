/**
 * @file flow integration — an awaited effect whose handler answers synchronously (F203, A Memory Missing on the A26).
 * While the frame loop ran, every awaited effect but `schedule` went on in the next frame's `signals` phase, after
 * `sync`: a window that asks `ready` before its commit was projected one frame late, so the dim came a frame after
 * the tap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, type } from "../../../../index";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi } from "../../../renderer/__tests__/fake-pixi";
import { worldPlugin } from "../../../world";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = defineNode({ rest: true, outcomes: { open: type(), slow: type() } });
// A transit node in front of a window: it asks an effect, then commits.
const ask = defineNode({
  outcomes: { open: type() },
  run: async ({ fx, out }) => {
    await fx({ kind: "probe" });

    return out.open();
  }
});
const askSlow = defineNode({
  outcomes: { open: type() },
  run: async ({ fx, out }) => {
    await fx({ kind: "slowProbe" });

    return out.open();
  }
});
const window = defineNode({ rest: true, outcomes: { back: type() } });
const main = defineFlow("main", {
  nodes: { home, ask, askSlow, window },
  start: "home",
  edges: {
    home: { open: "ask", slow: "askSlow" },
    ask: { open: "window" },
    askSlow: { open: "window" },
    window: { back: "home" }
  }
});
const game = defineFeature("windows", { flows: [main] });

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.unstubAllGlobals();
});

/**
 * Gives the runner its microtask turns.
 */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
}

/**
 * Starts the game on `home` with the frame loop running on the fake page, and records the path each frame's `sync`
 * phase sees: the frame that projects a commit is the frame that draws it.
 *
 * @returns The app, the per-frame paths and a single-frame driver.
 */
async function startGame() {
  installFakeDom({ width: 1080, height: 1920 });
  // A page with a frame loop: the loop counts as running, the frames are stepped by hand.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, game],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0,
        onDemand: true
      }
    }
  });

  await app.start();
  running.push(app);
  app.flow.fx.handle("probe", () => true);
  app.flow.fx.handle("slowProbe", () => Promise.resolve(true));
  app.flow.run().catch(() => undefined);

  const synced: string[] = [];

  app.time.onFrame("sync", () => {
    synced.push(app.flow.state().path);
  });

  /** Steps one frame of 16 ms, then gives the runner its turns. */
  const frame = async (): Promise<void> => {
    app.time.step(16);
    await turns();
  };

  await turns();
  for (let warm = 0; warm < 6 && app.flow.state().path !== "home"; warm += 1) await frame();

  return { app, synced, frame };
}

describe("flow integration: an effect answered synchronously (F203)", () => {
  // Bug: the probe answered at once, but the body went on in the next `signals` phase, after `sync`.
  it("projects the window in the first frame after the tap when the effect answers synchronously", async () => {
    const { app, synced, frame } = await startGame();

    expect(app.time.isRunning()).toBe(true);

    const before = synced.length;

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await turns();
    await frame();

    expect(synced.slice(before)).toEqual(["window"]);
  });

  // Guard: a handler that answers with a promise still goes on in the `signals` phase, one frame later.
  it("still projects the window a frame later when the effect answers with a promise", async () => {
    const { app, synced, frame } = await startGame();
    const before = synced.length;

    expect(app.flow.gate.answer({ intent: "slow" })).toBe(true);
    await turns();
    await frame();
    await frame();

    expect(synced.slice(before)).toEqual(["askSlow", "window"]);
  });
});
