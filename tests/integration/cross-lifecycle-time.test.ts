/**
 * @file Root integration — lifecycle against time, model and clock: the pause stack stops the
 * frames, the background flushes the save and the resume hands the graph the time that passed.
 */
import type { Lifecycle } from "@moku-labs/game";
import { createPlugin, lifecyclePlugin, type } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createEdgeLog, createGame, defineFlow, defineNode, tick } from "./helpers";

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const wait = defineNode({
  outcomes: { elapsed: type<{ now: number }>(), skip: type() },
  rest: true,
  inbox: ["elapsed"]
});

const main = defineFlow("main", {
  nodes: { home, wait },
  start: "home",
  edges: { home: { play: "wait" }, wait: { elapsed: "home", skip: "home" } }
});

/** A plugin that records the payload of every `lifecycle:changed`. The type is inferred. */
const createProbe = () => {
  const changes: Lifecycle.Events["lifecycle:changed"][] = [];
  const plugin = createPlugin("probe", {
    depends: [lifecyclePlugin],
    hooks: () => ({
      "lifecycle:changed": (payload: Lifecycle.Events["lifecycle:changed"]) => {
        changes.push(payload);
      }
    })
  });

  return { plugin, changes };
};

describe("lifecycle against time, model and clock", () => {
  it("pauses time while a reason is on the stack and resumes with the last one", async () => {
    const { app } = createGame({ mainFlow: main });

    await app.start();

    app.lifecycle.push("background");

    expect(app.time.isPaused()).toBe(true);
    expect(app.lifecycle.reasons()).toEqual(["background"]);

    app.lifecycle.push("system-dialog");
    app.lifecycle.pop("background");

    expect(app.time.isPaused()).toBe(true);

    app.lifecycle.pop("system-dialog");

    expect(app.time.isPaused()).toBe(false);
    expect(app.lifecycle.isPaused()).toBe(false);

    await app.stop();
  });

  it("announces every real change of the pause stack", async () => {
    const probe = createProbe();
    const { app } = createGame({ mainFlow: main, plugins: [probe.plugin] });

    await app.start();

    app.lifecycle.push("background");

    expect(app.lifecycle.reasons()).toEqual(["background"]);

    // The same reason twice is no change: no event, no second pause.
    app.lifecycle.push("background");
    app.lifecycle.pop("background");

    // The kernel dispatches a hook on a microtask, so a listener is read after a tick.
    await tick();

    expect(probe.changes).toEqual([
      {
        reason: "background",
        action: "push",
        reasons: ["background"],
        paused: true,
        resumed: false
      },
      { reason: "background", action: "pop", reasons: [], paused: false, resumed: true }
    ]);

    await app.stop();
  });

  it("asks the model to flush when the game goes to the background", async () => {
    const { app, provider } = createGame({ mainFlow: main });

    await app.start();

    expect(provider.calls).toEqual([]);

    app.lifecycle.push("background");
    await tick();

    expect(provider.calls.map(call => call.method)).toEqual(["flush"]);

    // Another reason is not a background pause: nothing is written a second time.
    app.lifecycle.push("system-dialog");
    await tick();

    expect(provider.calls.map(call => call.method)).toEqual(["flush"]);

    await app.stop();
  });

  it("hands the resting graph an elapsed input when the game resumes", async () => {
    const log = createEdgeLog();
    const { app, clock } = createGame({ mainFlow: main, plugins: [log.plugin] });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }]);

    expect(game.state().path).toBe("wait");

    app.lifecycle.push("background");
    clock.advance(120_000);
    await tick();

    expect(game.state().path).toBe("wait");

    app.lifecycle.pop("background");
    await tick();

    expect(game.state().path).toBe("home");
    // The clock was poked by the resume, so the wait ended with the world event, not with a tap.
    expect(log.edges).toEqual(["play", "elapsed"]);

    await game.stop();
  });
});
