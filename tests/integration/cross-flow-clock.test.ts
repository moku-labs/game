/**
 * @file Root integration — flow against clock: a node asks for the next moment with the `schedule`
 * effect, and the `elapsed` that arrives reaches only a rest node that lists it in its inbox.
 */
import { schedule, type } from "@moku-labs/game";
import { commands, run } from "@moku-labs/game/control";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createEdgeLog,
  createGame,
  defineFlow,
  defineNode,
  installFrameSource,
  startMoment,
  tick
} from "./helpers";

const boot = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, now, out }) => {
    await fx(schedule(now + 500));

    return out.done();
  }
});

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const arm = defineNode({
  outcomes: { armed: type() },
  run: async ({ fx, now, out }) => {
    await fx(schedule(now + 1000));

    return out.armed();
  }
});

const wait = defineNode({
  outcomes: { elapsed: type<{ now: number }>(), skip: type() },
  rest: true,
  inbox: ["elapsed"]
});

const main = defineFlow("timers", {
  nodes: { boot, home, arm, wait },
  start: "boot",
  edges: {
    boot: { done: "home" },
    home: { play: "arm" },
    arm: { armed: "wait" },
    wait: { elapsed: "home", skip: "home" }
  }
});

describe("flow against clock", () => {
  // Bug (F157): a visual test or the editor moves frames but not the clock, so a moment a rest node waits on never
  // comes; game.clock moves the clock forward and the moment arrives through the graph.
  it("reaches the armed moment through the door game.clock, short of it only after the whole wait", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    try {
      const log = createEdgeLog();
      const { app } = createGame({ mainFlow: main, plugins: [log.plugin] });
      const game = await createHeadless(app);

      await game.walk([{ at: "home", intent: "play" }]);
      expect(game.state().path).toBe("wait");

      const short = await run(app, commands.clock, { advanceMs: 999 });

      await tick();
      expect(short.value).toEqual({ now: startMoment + 999 });
      expect(game.state().path).toBe("wait");

      const due = await run(app, commands.clock, { advanceMs: 1 });

      await tick();
      expect(due.value).toEqual({ now: startMoment + 1000 });
      expect(game.state().path).toBe("home");
      expect(log.edges).toEqual(["done", "play", "armed", "elapsed"]);
      // It changes what the game sees: the session is tainted, as after a restore.
      expect(due.state.tainted).toBe(true);

      await game.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("delivers the due moment to the rest node that lists elapsed", async () => {
    const log = createEdgeLog();
    const { app, clock } = createGame({ mainFlow: main, plugins: [log.plugin] });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }]);

    expect(game.state().path).toBe("wait");
    expect(app.clock.dueAt()).toBe(startMoment + 1000);

    clock.advance(1000);
    await tick();

    expect(game.state().path).toBe("home");
    expect(app.clock.dueAt()).toBeUndefined();
    expect(log.edges).toEqual(["done", "play", "armed", "elapsed"]);

    await game.stop();
  });

  it("keeps an event the resting node does not list and delivers it at the next one", async () => {
    const log = createEdgeLog();
    const { app, clock } = createGame({ mainFlow: main, plugins: [log.plugin] });
    const game = await createHeadless(app);

    expect(game.state().path).toBe("home");

    // `home` does not list `elapsed`, so the event waits in the inbox instead of moving the graph.
    clock.advance(500);
    await tick();

    expect(game.state().path).toBe("home");
    expect(log.edges).toEqual(["done"]);

    await game.walk([{ at: "home", intent: "play" }]);

    // `wait` lists it, so the queued event ends the wait without a second tick of the clock.
    expect(game.state().path).toBe("home");
    expect(log.edges).toEqual(["done", "play", "armed", "elapsed"]);

    await game.stop();
  });

  // Bug (F61): while the frame loop runs, a transit node that arms the clock waits for the next frame's `signals`
  // phase although the handler only writes a moment: the way to a scene switch costs the player a frame.
  it("goes on past a node that awaits schedule without waiting for a frame while the loop runs", async () => {
    const source = installFrameSource();

    try {
      const { app } = createGame({ mainFlow: main });

      await app.start();
      expect(app.time.isRunning()).toBe(true);

      app.flow.run().catch(() => undefined);
      await tick();
      expect(app.flow.state().path).toBe("home");

      app.flow.gate.answer({ intent: "play" });
      await tick(20);

      // No frame ran: `arm` armed the clock and the graph rests at `wait` already.
      expect(app.flow.state().path).toBe("wait");
      expect(app.clock.dueAt()).toBe(startMoment + 1000);

      await app.stop();
    } finally {
      source.uninstall();
    }
  });
});
