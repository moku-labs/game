/**
 * @file Root integration — the frame journey: `stepFrames` drives the six phases in their fixed
 * order, and two effects that end in one frame resume in the order they were started.
 */
import type { Time } from "@moku-labs/game";
import { type } from "@moku-labs/game";
import { stepFrames } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, installFrameSource, tick } from "./helpers";

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const race = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, session, out }) => {
    const order: string[] = [];

    await Promise.all([
      fx({ kind: "slow" }).then(() => {
        order.push("first");
      }),
      fx({ kind: "quick" }).then(() => {
        order.push("second");
      })
    ]);

    session.resumed = order;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, race },
  start: "home",
  edges: { home: { play: "race" }, race: { done: "home" } }
});

/** The six phases in the order the engine runs them. */
const phases: Time.Phase[] = ["input", "animate", "layout", "sync", "signals", "render"];

describe("the frame journey", () => {
  it("runs the six phases of a frame in their fixed order", async () => {
    const { app } = createGame({ mainFlow: main });

    await app.start();

    const calls: string[] = [];
    // Registered back to front: the phase decides the call order, not the registration.
    const offs = phases.toReversed().map(phase =>
      app.time.onFrame(phase, () => {
        calls.push(phase);
      })
    );

    stepFrames(app, 2, 16);

    expect(calls).toEqual([...phases, ...phases]);
    expect(app.time.snapshot()).toMatchObject({ frame: 2, delta: 16, elapsed: 32 });

    for (const off of offs) off();

    await app.stop();
  });

  it("resumes two effects of one frame in the order they were started", async () => {
    const source = installFrameSource();

    try {
      const { app } = createGame({ mainFlow: main });

      await app.start();

      expect(app.time.isRunning()).toBe(true);

      // The first effect started is the slower one: only the start order can put it first.
      app.flow.fx.handle("slow", async () => {
        await tick(3);

        return "slow";
      });
      app.flow.fx.handle("quick", () => "quick");

      app.flow.run().catch(() => undefined);
      await tick();

      app.flow.gate.answer({ intent: "play" });
      await tick(20);

      // Both handlers are done, but a completion waits for the next `signals` phase.
      expect(app.flow.state().path).toBe("race");
      expect(app.model.store.snapshot().session).toMatchObject({ resumed: [] });

      stepFrames(app, 1, 16);
      await tick(20);

      expect(app.flow.state().path).toBe("home");
      expect(app.model.store.snapshot().session).toMatchObject({ resumed: ["first", "second"] });

      await app.stop();
    } finally {
      source.uninstall();
    }
  });
});
