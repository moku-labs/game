/**
 * @file Root integration — the `pluginConfigs` of `createApp` reaching the real plugins, and the
 * one error a graph with problems starts with.
 */
import { type } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, installFrameSource, tick } from "./helpers";

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

/** A node no edge leads to, and a flow that keeps it anyway. */
const lost = defineNode({
  outcomes: { done: type() },
  run: ({ out }) => out.done()
});

const broken = defineFlow("broken", {
  nodes: { home, lost },
  start: "home",
  edges: { home: { play: "home" }, lost: { done: "home" } }
});

describe("core config", () => {
  it("caps the frame rate at the configured maxFps", async () => {
    const source = installFrameSource();

    try {
      const { app } = createGame({ mainFlow: main, maxFps: 30 });

      await app.start();

      expect(app.time.isRunning()).toBe(true);

      source.run(1000);

      // The first frame counts as one capped frame instead of the gap to a stale timestamp.
      expect(app.time.read().frame).toBe(1);
      expect(app.time.read().delta).toBeCloseTo(1000 / 30);

      source.run(1020);

      expect(app.time.read().frame).toBe(1);

      source.run(1040);

      expect(app.time.read().frame).toBe(2);

      await app.stop();
    } finally {
      source.uninstall();
    }
  });

  it("gives the model plugin its provider and its seed", async () => {
    const provider = memory();
    const { app } = createGame({ mainFlow: main, provider, seed: 7 });

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();

    expect(app.model.store.snapshot().rng.seed).toBe(7);
    // The loop reads the save through the configured provider, and a new player is saved at once.
    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit"]);

    await app.flow.walk([{ at: "home", intent: "play" }]);

    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit", "commit"]);

    await app.stop();
  });

  it("reads time through the configured clock source", async () => {
    const clock = fakeClock(5000);
    const { app } = createGame({ mainFlow: main, clock });

    await app.start();

    expect(app.clock.now()).toBe(5000);

    clock.advance(250);

    expect(app.clock.now()).toBe(5250);

    await app.stop();
  });

  it("gives the flow plugin its main flow and its safe node", async () => {
    const { app } = createGame({ mainFlow: main, safeNode: "home", retries: 3 });

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();

    expect(app.flow.describe().main).toBe("main");
    expect(app.flow.describe().flows.main?.nodes.home).toMatchObject({
      rest: true,
      checkpoint: true
    });
    expect(app.flow.state().path).toBe("home");

    await app.stop();
  });

  it("reports every problem of a graph in one error", async () => {
    const { app } = createGame({ mainFlow: broken, safeNode: "nowhere" });

    await app.start();

    const failure = await app.flow.run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      '[game] Flow "broken": node "lost" cannot be reached from the start node "home".'
    );
    expect(String(failure)).toContain('[game] The safe node "nowhere" is not a node of the graph.');

    await app.stop();
  });
});
