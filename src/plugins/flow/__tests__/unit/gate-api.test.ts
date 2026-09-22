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

type FakeTime = TimeApi & { setFrame(frame: number): void; setRunning(running: boolean): void };

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
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 1 };
  const flags = { running: true };

  return {
    onFrame: vi.fn(() => noop),
    snapshot: () => time,
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: () => false,
    isRunning: () => flags.running,
    step: vi.fn(),
    setFrame: (frame: number) => {
      time.frame = frame;
    },
    setRunning: (running: boolean) => {
      flags.running = running;
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
  features: { byName: new Map(), sealed: false },
  fx: { handlers: new Map(), buffered: [], hintListeners: [], settled: [], mode: "live" },
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

const createMockCtx = (): { ctx: FlowCtx; time: FakeTime } => {
  const time = createFakeTime();
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
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
      gate.clearHeld(1);

      await expect(gate.open({ allowed: ["play"] })).resolves.toEqual({ intent: "play" });
    });

    it("drops the hold on the next frame", async () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);
      const answers: Answer[] = [];

      gate.answer({ intent: "play" });
      gate.clearHeld(2);

      expect(ctx.state.gate.held).toBeUndefined();

      gate.open({ allowed: ["play"] }).then(answer => answers.push(answer));
      await Promise.resolve();

      expect(answers).toEqual([]);
    });

    it("does nothing when no answer is held", () => {
      const { ctx } = createMockCtx();
      const gate = createGateApi(ctx);

      gate.clearHeld(7);

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
