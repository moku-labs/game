import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as TimeApi } from "../../../time/types";
import { createGateState } from "../../gate/state";
import { createInboxApi } from "../../inbox/api";
import { createInboxState } from "../../inbox/state";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createInboxApi (mock context, no kernel)
// ---------------------------------------------------------------------------

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

const createMockTime = (): TimeApi => ({
  onFrame: vi.fn(() => noop),
  snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1 }),
  setScale: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  isPaused: () => false,
  isRunning: () => true,
  step: vi.fn()
});

const createMockDeps = (): Deps => ({
  time: createMockTime(),
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
    "[game] The inbox unit test resolves no plugin.\n  Inject the dependency instead."
  );
};

const createTestState = (): State => ({
  features: { byName: new Map(), sealed: false },
  fx: { handlers: new Map(), buffered: [], settled: [], mode: "live" },
  gate: createGateState(),
  inbox: createInboxState(),
  runner: {
    flushing: undefined,
    flows: new Map(),
    enterCallbacks: { load: [], scene: [] },
    stack: [],
    restFrame: undefined,
    journal: [],
    journalIndex: 0,
    running: undefined,
    abort: undefined,
    failures: 0
  }
});

const createMockCtx = (): FlowCtx => {
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };

  return {
    config,
    state: createTestState(),
    emit: vi.fn(),
    global: {},
    log: createMockLog(),
    require: notRequired,
    deps: createMockDeps()
  };
};

describe("createInboxApi", () => {
  describe("post", () => {
    it("queues an event", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "elapsed", payload: { now: 1000 } });

      expect(ctx.state.inbox.queue).toEqual([{ type: "elapsed", payload: { now: 1000 } }]);
    });

    it("collapses duplicates of one type to the latest", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "elapsed", payload: { now: 1000 } });
      inbox.post({ type: "elapsed", payload: { now: 2000 } });

      expect(ctx.state.inbox.queue).toEqual([{ type: "elapsed", payload: { now: 2000 } }]);
    });

    it("keeps the place of a collapsed type, so the queue stays oldest first", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "elapsed", payload: { now: 1000 } });
      inbox.post({ type: "purchase", payload: { id: "gems" } });
      inbox.post({ type: "elapsed", payload: { now: 2000 } });

      expect(ctx.state.inbox.queue.map(event => event.type)).toEqual(["elapsed", "purchase"]);
    });
  });

  describe("take", () => {
    it("returns the first event of an accepted type and removes it", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "elapsed", payload: { now: 1000 } });

      expect(inbox.take(["elapsed"])).toEqual({ type: "elapsed", payload: { now: 1000 } });
      expect(ctx.state.inbox.queue).toEqual([]);
    });

    it("leaves the events the node does not accept queued", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "purchase", payload: { id: "gems" } });
      inbox.post({ type: "elapsed", payload: { now: 1000 } });

      expect(inbox.take(["elapsed"])).toEqual({ type: "elapsed", payload: { now: 1000 } });
      expect(ctx.state.inbox.queue).toEqual([{ type: "purchase", payload: { id: "gems" } }]);
    });

    it("returns the oldest of several accepted events", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "purchase" });
      inbox.post({ type: "elapsed" });

      expect(inbox.take(["elapsed", "purchase"])).toEqual({ type: "purchase" });
    });

    it("returns undefined and touches nothing when no event is accepted", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "purchase" });

      expect(inbox.take(["elapsed"])).toBeUndefined();
      expect(ctx.state.inbox.queue).toEqual([{ type: "purchase" }]);
    });

    it("returns undefined on an empty queue", () => {
      expect(createInboxApi(createMockCtx()).take(["elapsed"])).toBeUndefined();
    });

    it("delivers one event only once", () => {
      const ctx = createMockCtx();
      const inbox = createInboxApi(ctx);

      inbox.post({ type: "elapsed" });
      inbox.take(["elapsed"]);

      expect(inbox.take(["elapsed"])).toBeUndefined();
    });
  });

  describe("onPost", () => {
    it("tells the listener that an event arrived", () => {
      const inbox = createInboxApi(createMockCtx());
      const listener = vi.fn();

      inbox.onPost(listener);
      inbox.post({ type: "elapsed" });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stops telling a listener that unsubscribed", () => {
      const inbox = createInboxApi(createMockCtx());
      const listener = vi.fn();

      const off = inbox.onPost(listener);
      off();
      inbox.post({ type: "elapsed" });

      expect(listener).not.toHaveBeenCalled();
    });

    it("keeps the other listeners when one unsubscribes twice", () => {
      const inbox = createInboxApi(createMockCtx());
      const first = vi.fn();
      const second = vi.fn();

      const off = inbox.onPost(first);
      inbox.onPost(second);
      off();
      off();
      inbox.post({ type: "elapsed" });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("keeps delivering to a listener that unsubscribes during the call", () => {
      const inbox = createInboxApi(createMockCtx());
      const second = vi.fn();

      const off = inbox.onPost(() => off());
      inbox.onPost(second);
      inbox.post({ type: "elapsed" });

      expect(second).toHaveBeenCalledTimes(1);
    });

    it("wakes a listener registered on another instance over the same state", () => {
      const ctx = createMockCtx();
      const runnerSide = createInboxApi(ctx);
      const clockSide = createInboxApi(ctx);
      const listener = vi.fn();
      runnerSide.onPost(listener);

      clockSide.post({ type: "elapsed" });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
