import { describe, expect, it } from "vitest";
import { createApp, defineGame, type Flow, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";

// ---------------------------------------------------------------------------
// Integration: the guide of a node, derived from state (F98). The real time,
// lifecycle, model, clock and flow plugins; the `guide` handler is the test's.
// The tutorial's step is in the session: the rest node `board` guides it, the
// transit node `advance` writes the next step on the edge of the allowed answer.
// ---------------------------------------------------------------------------

type Session = { step: number; blocked: number };

const { defineNode, defineFlow } = defineGame<{
  player: { coins: number };
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The answer a press outside the window gives. */
const BLOCKED = { intent: "tutorialBlocked" };

/** The guide of each step: merge, then deliver, then none. Step 9 throws. */
const STEPS: Record<number, Flow.GuideOptions | undefined> = {
  0: {
    allow: { intent: "merge", payload: { from: "c2", to: "c3" } },
    target: [
      { projection: "board.items", key: "c2" },
      { projection: "board.items", key: "c3" }
    ],
    blocked: BLOCKED
  },
  1: { allow: { intent: "deliver" }, target: { projection: "board.strip", key: "order0" } }
};

/** How often the guide of `board` was derived. */
const derived = { count: 0 };

const board = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: {
    merge: type<{ from: string; to: string }>(),
    deliver: type(),
    tutorialBlocked: type(),
    leave: type()
  },
  guide: ({ session }) => {
    derived.count += 1;

    if (session.step === 9) throw new Error("step 9 is not written yet.");

    return STEPS[session.step];
  }
});

const advance = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.step += 1;

    return out.done();
  }
});

const scold = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.blocked += 1;

    return out.done();
  }
});

const lobby = defineNode({ rest: true, checkpoint: true, outcomes: { back: type() } });

const mainFlow = defineFlow("main", {
  nodes: { board, advance, scold, lobby },
  start: "board",
  edges: {
    board: { merge: "advance", deliver: "advance", tutorialBlocked: "scold", leave: "lobby" },
    advance: { done: "board" },
    scold: { done: "board" },
    lobby: { back: "board" }
  }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** What the `guide` handler was shown, and with which signal. */
type Shown = { payloads: unknown[]; signals: AbortSignal[] };

/**
 * Starts the game at a step, with the test's `guide` handler, and lets it rest.
 *
 * @param step - The step the session starts at.
 * @param mode - `"fast"` switches the graph to fast mode before it runs.
 * @returns The app and what the handler was shown.
 */
async function startGame(step: number, mode: "live" | "fast" = "live") {
  derived.count = 0;

  const app = createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0 },
        initialSession: { step, blocked: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow, safeNode: "lobby" }
    }
  });
  const shown: Shown = { payloads: [], signals: [] };

  await app.start();
  app.flow.fx.handle("guide", (descriptor, { signal }) => {
    shown.payloads.push(descriptor.payload);
    shown.signals.push(signal);
  });
  app.flow.setMode(mode);
  app.flow.run().catch(() => undefined);
  await tick();

  return { app, shown };
}

describe("the guide of a rest node without a body", () => {
  // Bug caught: a tutorial step that is data reaches neither the gate nor the screen.
  it("holds the guide its state derives: the gate is narrowed and the handler shows it", async () => {
    const { app, shown } = await startGame(0);

    expect(app.flow.state().path).toBe("board");
    expect(shown.payloads).toEqual([STEPS[0]]);
    expect(app.flow.gate.state()).toEqual({
      open: true,
      allowed: ["merge", "deliver", "tutorialBlocked", "leave"],
      narrowed: true,
      blocked: BLOCKED
    });
    expect(app.flow.gate.answer({ intent: "leave" })).toBe(false);
    expect(app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c9" } })).toBe(
      false
    );

    await app.stop();
  });

  // Bug caught: the guide is shown once and never follows the step the edges commit.
  it("follows the state the edges commit, and lifts the old guide first", async () => {
    const { app, shown } = await startGame(0);

    expect(app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } })).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toEqual({ step: 1, blocked: 0 });
    expect(shown.payloads).toEqual([STEPS[0], STEPS[1]]);
    expect(shown.signals[0]?.aborted).toBe(true);
    expect(shown.signals[1]?.aborted).toBe(false);
    expect(app.flow.gate.state().blocked).toBeUndefined();

    // Step 2 guides nothing: the node rests with no narrow.
    expect(app.flow.gate.answer({ intent: "deliver" })).toBe(true);
    await tick();

    expect(shown.payloads).toHaveLength(2);
    expect(shown.signals[1]?.aborted).toBe(true);
    expect(app.flow.gate.state().narrowed).toBe(false);

    await app.stop();
  });

  // Bug caught: the press outside the window answers nothing the gate takes.
  it("takes the blocked answer and shows the same guide again on return", async () => {
    const { app, shown } = await startGame(0);

    expect(app.flow.gate.answer(BLOCKED)).toBe(true);
    await tick();

    expect(app.model.store.snapshot().session).toEqual({ step: 0, blocked: 1 });
    expect(shown.payloads).toEqual([STEPS[0], STEPS[0]]);
    expect(app.flow.gate.state().narrowed).toBe(true);

    await app.stop();
  });

  // Bug caught: the narrow of a guide outlives its node, or the edge's commit shows it again.
  it("lifts on exit: the next node is not narrowed and the guide is not shown again", async () => {
    const { app, shown } = await startGame(1);

    // Leaving is refused while the guide stands; step 2 guides nothing, so the board is left.
    expect(app.flow.gate.answer({ intent: "deliver" })).toBe(true);
    await tick();
    expect(app.flow.gate.answer({ intent: "leave" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("lobby");
    expect(app.flow.gate.state()).toEqual({ open: true, allowed: ["back"], narrowed: false });
    expect(shown.payloads).toEqual([STEPS[1]]);
    expect(shown.signals[0]?.aborted).toBe(true);

    await app.stop();
  });

  // Bug caught: a restored game opens without its tutorial step, which no save field keeps.
  it("is derived again after a restore: the bookmark keeps no guide", async () => {
    const { app, shown } = await startGame(0);
    const atMerge = app.flow.bookmark();

    expect(app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } })).toBe(true);
    await tick();
    expect(shown.payloads.at(-1)).toEqual(STEPS[1]);

    await app.flow.restore(atMerge);
    await tick();

    expect(Object.keys(atMerge).includes("guide")).toBe(false);
    expect(shown.payloads.at(-1)).toEqual(STEPS[0]);
    expect(shown.signals.at(-2)?.aborted).toBe(true);
    expect(app.flow.gate.state().blocked).toEqual(BLOCKED);

    await app.stop();
  });

  // Bug caught: a guide that throws leaves the player at an open gate with no tutorial.
  it("fails the node when its guide throws: rollback, retry, then the safe node", async () => {
    const { app, shown } = await startGame(9);
    const failures = app.log.trace().filter(entry => entry.event === "flow:error");

    expect(failures.map(entry => entry.data)).toEqual([
      expect.objectContaining({ path: "board", rolledBackTo: "board", retry: true }),
      expect.objectContaining({ path: "board", rolledBackTo: "lobby", retry: false })
    ]);
    expect((failures[0]?.data as { error: { message: string } } | undefined)?.error.message).toBe(
      '[game] The guide of node "board" threw: step 9 is not written yet.\n  Return GuideOptions or undefined from guide.'
    );
    expect(app.flow.state().path).toBe("lobby");
    expect(shown.payloads).toEqual([]);
    expect(derived.count).toBe(2);

    await app.stop();
  });

  // Bug caught: a fast walk skips the narrow, or draws a guide nobody sees.
  it("narrows in fast mode and draws nothing", async () => {
    const { app, shown } = await startGame(0, "fast");

    expect(app.flow.state().mode).toBe("fast");
    expect(app.flow.gate.state().narrowed).toBe(true);
    expect(shown.payloads).toEqual([]);
    await expect(app.flow.walk([{ at: "board", intent: "leave" }])).rejects.toThrow(
      'flow.walk() could not answer "leave" at "board".'
    );

    await app.stop();
  });
});
