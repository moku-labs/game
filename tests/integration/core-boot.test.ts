/**
 * @file Root integration — booting the assembled engine: start, stop, the one loop and the plugin
 * APIs the app carries.
 */
import { createApp, type } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, startMoment, tick } from "./helpers";

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const visit = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.visits += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, visit },
  start: "home",
  edges: { home: { play: "visit" }, visit: { done: "home" } }
});

describe("core boot", () => {
  it("starts and stops an app that never ran its graph", async () => {
    const { app, provider } = createGame({ mainFlow: main });

    await app.start();

    expect(app.flow.state().running).toBe(false);
    // The save is read by the loop, so a game that never ran never touched the provider.
    expect(provider.calls).toEqual([]);

    await app.stop();
  });

  it("refuses a second start", async () => {
    const { app } = createGame({ mainFlow: main });

    await app.start();

    await expect(app.start()).rejects.toThrow("[game] App already started.");

    await app.stop();
  });

  it("refuses stop before start", async () => {
    const { app } = createGame({ mainFlow: main });

    await expect(app.stop()).rejects.toThrow("[game] App not started.");
  });

  it("rejects flow.run() when no main flow is configured", async () => {
    const app = createApp();

    await app.start();

    await expect(app.flow.run()).rejects.toThrow(
      "[game] flow.run() needs a main flow.\n  Pass it as pluginConfigs.flow.mainFlow."
    );

    await app.stop();
  });

  it("throws when flow.run() is called twice", async () => {
    const { app } = createGame({ mainFlow: main });

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();

    expect(() => app.flow.run()).toThrow("[game] flow.run() was already called.");
    expect(app.flow.state()).toMatchObject({ running: true, path: "home", mode: "live" });

    await app.stop();
  });

  it("mounts the API of every engine plugin on the app", async () => {
    const { app } = createGame({ mainFlow: main });

    await app.start();

    expect(app.time.read()).toMatchObject({ frame: 0, scale: 1 });
    expect(app.lifecycle.isPaused()).toBe(false);
    expect(app.model.store.snapshot().player).toEqual({ coins: 0, visits: 0, draws: [] });
    expect(app.clock.now()).toBe(startMoment);
    expect(app.flow.describe().main).toBe("main");
    expect(app.flow.gate.state()).toEqual({ open: false, allowed: [], narrowed: false });

    await app.stop();
  });
});
