import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Time, Api as TimeApi } from "../../../time/types";
import { createGateApi } from "../../gate/api";
import { createGateState } from "../../gate/state";
import type { Answer } from "../../gate/types";
import { createInboxState } from "../../inbox/state";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createGateApi (mock context, no kernel)
// ---------------------------------------------------------------------------

type FakeTime = TimeApi & {
  setFrame(frame: number): void;
  setRunning(running: boolean): void;
  /** Starts the next frame: the frame number moves on by one and game time by `ms`. */
  advance(ms: number): void;
};

type Gate = ReturnType<typeof createGateApi>;

const noop = (): void => {};

const createMockLog = (): Log.LogApi => ({
  addSink: vi.fn(),
  clearSinks: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  expect: vi.fn(),
  info: vi.fn(),
  reset: vi.fn(),
  trace: vi.fn(() => []),
  warn: vi.fn()
});

const createFakeTime = (): FakeTime => {
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 1, idle: false };
  const flags = { running: true };

  return {
    onFrame: vi.fn(() => noop),
    snapshot: () => time,
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    wake: vi.fn(),
    wakes: () => 0,
    measure: vi.fn(),
    agentClock: () => undefined,
    chargeAgent: vi.fn(),
    isPaused: () => false,
    isRunning: () => flags.running,
    step: vi.fn(),
    setFrame: (frame: number) => {
      time.frame = frame;
    },
    setRunning: (running: boolean) => {
      flags.running = running;
    },
    advance: (ms: number) => {
      time.frame += 1;
      time.elapsed += ms;
    }
  };
};

const createMockDeps = (time: TimeApi): Deps => ({
  time,
  model: {
    store: {
      load: vi.fn(),
      snapshot: vi.fn(),
      begin: vi.fn(),
      markRest: vi.fn(),
      markBarrier: vi.fn(),
      rollback: vi.fn(),
      restore: vi.fn(),
      flush: vi.fn()
    },
    rng: { peek: vi.fn() }
  },
  clock: {
    now: vi.fn(() => 0),
    scheduleAt: vi.fn(),
    onElapsed: vi.fn(() => noop),
    poke: vi.fn(),
    dueAt: vi.fn()
  }
});

const notRequired: Require = () => {
  throw new Error(
    "[game] The gate unit test resolves no plugin.\n  Inject the dependency instead."
  );
};

const createTestState = (): State => ({
  features: { byName: new Map(), parentOf: new Map(), sealed: false },
  fx: {
    handlers: new Map(),
    buffered: [],
    hintListeners: [],
    settled: [],
    guides: [],
    mode: "live"
  },
  gate: createGateState(),
  inbox: createInboxState(),
  runner: {
    flushing: undefined,
    flows: new Map(),
    enterCallbacks: { load: [], scene: [] },
    stack: [],
    restFrame: undefined,
    slotAfter: undefined,
    journal: [],
    journalIndex: 0,
    running: undefined,
    abort: undefined,
    failures: 0
  }
});

const createMockCtx = (holdMs = 0): { ctx: FlowCtx; time: FakeTime } => {
  const time = createFakeTime();
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500,
    holdMs
  };

  return {
    time,
    ctx: {
      config,
      state: createTestState(),
      emit: vi.fn(),
      global: {},
      log: createMockLog(),
      require: notRequired,
      deps: createMockDeps(time)
    }
  };
};

/**
 * Plays one frame the way `connectFlow` wires it: game time moves on, then the `signals` phase
 * lets the gate age its hold.
 *
 * @param gate - The gate under test.
 * @param time - The fake time of the test.
 * @param ms - Game time this frame adds.
 */
const playFrame = (gate: Gate, time: FakeTime, ms: number): void => {
  time.advance(ms);

  const { frame, elapsed } = time.snapshot();

  gate.clearHeld(frame, elapsed);
};

/**
 * Opens the gate for `play` and collects what it is answered with in this turn.
 *
 * @param gate - The gate under test.
 * @returns The answers the opening gate took: the held one, or none.
 */
const openForPlay = async (gate: Gate): Promise<Answer[]> => {
  const answers: Answer[] = [];

  gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
  await Promise.resolve();

  return answers;
};

/**
 * The case measured in the demo game: the player presses at the start of a transition, and the
 * gate stays closed for `closedMs` of game time, played in frames of 16 ms.
 *
 * @param holdMs - The configured hold time.
 * @param closedMs - How long the gate stays closed after the press.
 * @returns What the gate that opens afterwards is answered with.
 */
const pressThenWait = (holdMs: number, closedMs: number): Promise<Answer[]> => {
  const { ctx, time } = createMockCtx(holdMs);
  const gate = createGateApi(ctx);

  gate.answer({ intent: "play" });
  for (let waited = 0; waited < closedMs; waited += 16) playFrame(gate, time, 16);

  return openForPlay(gate);
};

describe("createGateApi", () => {
  describe("state", () => {
    it("reports a closed gate with no allowed intent by default", () => {
      const { ctx } = createMockCtx();

      expect(createGateApi(ctx).state()).toEqual({ open: false, allowed: [], narrowed: false });
    });

    it("reports the allowed intents while the gate is open", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.open({ allowed: ["play", "shop"] });

      expect(gate.state()).toEqual({ open: true, allowed: ["play", "shop"], narrowed: false });
    });
  });

  describe("answer", () => {
    it("refuses an answer while the gate is closed", () => {
      const { ctx } = createMockCtx();

      expect(createGateApi(ctx).answer({ intent: "play" })).toBe(false);
    });

    it("accepts an allowed intent and resolves the open promise with it", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const pending = gate.open({ allowed: ["merge"] });

      expect(gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } })).toBe(true);

      await expect(pending).resolves.toEqual({
        intent: "merge",
        payload: { from: "c2", to: "c3" }
      });
    });

    it("closes before the answer is handed on, so a double tap hits a closed door", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const pending = gate.open({ allowed: ["play"] });

      expect(gate.answer({ intent: "play", payload: 1 })).toBe(true);
      expect(gate.answer({ intent: "play", payload: 2 })).toBe(false);
      expect(gate.state().open).toBe(false);

      await expect(pending).resolves.toEqual({ intent: "play", payload: 1 });
    });

    it("refuses an intent the open gate does not list and stays open", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.open({ allowed: ["play"] });

      expect(gate.answer({ intent: "shop" })).toBe(false);
      expect(gate.state().open).toBe(true);
    });
  });

  describe("hold", () => {
    it("re-offers an answer given to a closed gate when it opens in the same frame", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      expect(gate.answer({ intent: "play" })).toBe(false);

      await expect(gate.open({ allowed: ["play"] })).resolves.toEqual({ intent: "play" });
    });

    it("keeps the first answer when a second arrives in the same frame", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play", payload: 1 });
      gate.answer({ intent: "play", payload: 2 });

      await expect(gate.open({ allowed: ["play"] })).resolves.toEqual({
        intent: "play",
        payload: 1
      });
    });

    it("drops a held answer the opening gate does not allow", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      gate.answer({ intent: "shop" });
      gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
      expect(gate.state().open).toBe(true);
      expect(ctx.state.gate.held).toBeUndefined();
    });

    it("holds nothing in fast mode", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      ctx.state.fx.mode = "fast";
      gate.answer({ intent: "play" });

      expect(ctx.state.gate.held).toBeUndefined();

      gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
    });

    it("holds nothing while time is not running", async () => {
      const { ctx, time } = createMockCtx();
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      time.setRunning(false);
      gate.answer({ intent: "play" });

      expect(ctx.state.gate.held).toBeUndefined();

      gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
    });
  });

  describe("clearHeld", () => {
    it("keeps the hold while the frame it was given in is the current one", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      gate.clearHeld(1, 0);

      await expect(gate.open({ allowed: ["play"] })).resolves.toEqual({ intent: "play" });
    });

    it("drops the hold on the next frame", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      gate.answer({ intent: "play" });
      gate.clearHeld(2, 16);

      expect(ctx.state.gate.held).toBeUndefined();

      gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
    });

    it("does nothing when no answer is held", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.clearHeld(7, 96);

      expect(ctx.state.gate.held).toBeUndefined();
    });
  });

  describe("hold with holdMs", () => {
    it("records the frame and the game time of the refusal", () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      playFrame(gate, time, 250);
      gate.answer({ intent: "play" });

      expect(ctx.state.gate.held).toEqual({ answer: { intent: "play" }, frame: 2, at: 250 });
    });

    it("delivers an answer refused at 0 ms to a gate that opens at 300 ms", async () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      playFrame(gate, time, 100);
      playFrame(gate, time, 200);

      expect(await openForPlay(gate)).toEqual([{ intent: "play" }]);
      expect(ctx.state.gate.held).toBeUndefined();
    });

    it("keeps the answer while it is exactly holdMs old", async () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      playFrame(gate, time, 500);

      expect(await openForPlay(gate)).toEqual([{ intent: "play" }]);
    });

    it("drops the answer once it is older than holdMs", async () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      playFrame(gate, time, 600);

      expect(ctx.state.gate.held).toBeUndefined();
      expect(await openForPlay(gate)).toEqual([]);
    });

    it("keeps the last of two answers", async () => {
      const { ctx } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play", payload: 1 });
      gate.answer({ intent: "play", payload: 2 });

      expect(await openForPlay(gate)).toEqual([{ intent: "play", payload: 2 }]);
    });

    it("counts the age from the last refusal", async () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play", payload: 1 });
      playFrame(gate, time, 400);
      gate.answer({ intent: "play", payload: 2 });
      playFrame(gate, time, 300);

      // 700 ms after the first press, 300 ms after the second: the second is still young.
      expect(await openForPlay(gate)).toEqual([{ intent: "play", payload: 2 }]);
    });

    it("loses a press made 1008 ms before the gate opens with holdMs 500", async () => {
      expect(await pressThenWait(500, 1008)).toEqual([]);
    });

    it("delivers a press made 1008 ms before the gate opens with holdMs 1100", async () => {
      expect(await pressThenWait(1100, 1008)).toEqual([{ intent: "play" }]);
    });

    it("delivers a press made 1008 ms before the gate opens with holdMs Infinity", async () => {
      expect(await pressThenWait(Number.POSITIVE_INFINITY, 1008)).toEqual([{ intent: "play" }]);
    });

    it("keeps the answer until the next gate opens with holdMs Infinity, however long that takes", async () => {
      const { ctx, time } = createMockCtx(Number.POSITIVE_INFINITY);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      playFrame(gate, time, 3_600_000);

      expect(await openForPlay(gate)).toEqual([{ intent: "play" }]);
    });

    it("does not age the answer while game time stands still", async () => {
      const { ctx, time } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      // A time scale of 0: the frames keep running and `elapsed` does not move.
      for (let frame = 0; frame < 120; frame += 1) playFrame(gate, time, 0);

      expect(await openForPlay(gate)).toEqual([{ intent: "play" }]);
    });

    it("offers the answer once: a gate that does not list the intent drops it", async () => {
      const { ctx } = createMockCtx(500);
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      gate.answer({ intent: "shop" });

      expect(await openForPlay(gate)).toEqual([]);
      expect(gate.state().open).toBe(true);
      expect(ctx.state.gate.held).toBeUndefined();

      gate.close();
      gate.open({ allowed: ["shop"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
    });

    it("drops the answer when a running guide does not let it through", async () => {
      const { ctx } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      gate.narrow({ intent: "merge" });

      expect(await openForPlay(gate)).toEqual([]);
      expect(ctx.state.gate.held).toBeUndefined();
    });

    it("holds nothing in fast mode", () => {
      const { ctx } = createMockCtx(500);
      const gate = createGateApi(ctx);

      ctx.state.fx.mode = "fast";
      gate.answer({ intent: "play" });

      expect(ctx.state.gate.held).toBeUndefined();
    });

    it("drops the answer without an offer when the gate opens in fast mode", async () => {
      const { ctx } = createMockCtx(500);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      // A fast walk starts: it answers its own gates.
      ctx.state.fx.mode = "fast";

      expect(await openForPlay(gate)).toEqual([]);
      expect(gate.state().open).toBe(true);
      expect(ctx.state.gate.held).toBeUndefined();
    });

    it("counts a negative holdMs as no hold time: one frame, first answer wins", async () => {
      const { ctx, time } = createMockCtx(-1);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play", payload: 1 });
      gate.answer({ intent: "play", payload: 2 });

      expect(ctx.state.gate.held?.answer).toEqual({ intent: "play", payload: 1 });

      playFrame(gate, time, 0);

      expect(ctx.state.gate.held).toBeUndefined();
    });
  });

  describe("dropHeld", () => {
    it("drops an answer held with holdMs Infinity, as when a bookmark is entered", async () => {
      const { ctx } = createMockCtx(Number.POSITIVE_INFINITY);
      const gate = createGateApi(ctx);

      gate.answer({ intent: "play" });
      gate.dropHeld();

      expect(ctx.state.gate.held).toBeUndefined();
      expect(await openForPlay(gate)).toEqual([]);
    });

    it("does nothing when no answer is held", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.dropHeld();

      expect(ctx.state.gate.held).toBeUndefined();
    });
  });

  describe("narrow", () => {
    it("lets only the narrowed intent through", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.narrow({ intent: "merge" });
      gate.open({ allowed: ["merge", "sell"] });

      expect(gate.answer({ intent: "sell" })).toBe(false);
      expect(gate.answer({ intent: "merge", payload: { from: "c2" } })).toBe(true);
    });

    it("compares the payload by deep equality when the allow carries one", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.narrow({ intent: "merge", payload: { from: "c2", to: ["c3", { level: 2 }] } });
      gate.open({ allowed: ["merge"] });

      expect(
        gate.answer({ intent: "merge", payload: { from: "c2", to: ["c3", { level: 3 }] } })
      ).toBe(false);
      expect(gate.answer({ intent: "merge", payload: { from: "c2" } })).toBe(false);
      expect(
        gate.answer({ intent: "merge", payload: { from: "c2", to: ["c3", { level: 2 }] } })
      ).toBe(true);
    });

    it("reports the narrowed flag and clears it with undefined", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.narrow({ intent: "merge" });

      expect(gate.state().narrowed).toBe(true);

      gate.narrow(undefined);
      gate.open({ allowed: ["sell"] });

      expect(gate.state().narrowed).toBe(false);
      expect(gate.answer({ intent: "sell" })).toBe(true);
    });
  });

  describe("open and close", () => {
    it("throws when the gate is opened twice", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.open({ allowed: ["play"] });

      expect(() => gate.open({ allowed: ["shop"] })).toThrow("[game] The gate is already open.");
    });

    it("closes an open gate and refuses later answers", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.open({ allowed: ["play"] });
      gate.close();

      expect(gate.state().open).toBe(false);
      expect(gate.answer({ intent: "play" })).toBe(false);
    });

    it("keeps a running narrow across a close, so a guide survives the node", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.narrow({ intent: "merge" });
      gate.open({ allowed: ["merge"] });
      gate.close();

      expect(gate.state().narrowed).toBe(true);
    });
  });

  describe("pointer", () => {
    it("records that a pointer is down and that it came up again", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.pointer(true);

      expect(ctx.state.gate.pointerActive).toBe(true);

      gate.pointer(false);

      expect(ctx.state.gate.pointerActive).toBe(false);
    });
  });
});
