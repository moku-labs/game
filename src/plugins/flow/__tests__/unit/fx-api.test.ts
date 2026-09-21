import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import { createFxApi } from "../../fx/api";
import { guide, hint, schedule } from "../../fx/descriptors";
import { createFxState } from "../../fx/state";
import type { Descriptor, FxHandler } from "../../fx/types";
import type { Answer, GateInternal, GateSpec } from "../../gate/types";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createFxApi, createFxState, descriptors (mock context, no kernel)
// ---------------------------------------------------------------------------

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const signal = (): AbortSignal => new AbortController().signal;

// The module under test resolves no dependency through the kernel; a call is a test bug.
const refuseRequire: Require = plugin => {
  throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
};

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

const createMockState = (): State => ({
  features: { byName: new Map(), sealed: false },
  fx: createFxState(),
  gate: {
    open: undefined,
    resolve: undefined,
    held: undefined,
    narrow: undefined,
    pointerActive: false
  },
  inbox: { queue: [], listeners: [] },
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

const createMockDeps = (isRunning: () => boolean): Deps => ({
  time: {
    onFrame: vi.fn(),
    read: vi.fn(),
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(),
    isRunning,
    step: vi.fn()
  },
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
    now: vi.fn(),
    scheduleAt: vi.fn(),
    onElapsed: vi.fn(),
    poke: vi.fn(),
    dueAt: vi.fn()
  }
});

const createGateStub = () => {
  const opened: GateSpec[] = [];
  const waiting: Array<(answer: Answer) => void> = [];
  const gate: GateInternal = {
    open: (spec: GateSpec): Promise<Answer> => {
      opened.push(spec);
      return new Promise<Answer>(resolve => {
        waiting.push(resolve);
      });
    },
    close: vi.fn(),
    narrow: vi.fn(),
    clearHeld: vi.fn()
  };

  return {
    gate,
    opened,
    reply: (answer: Answer): void => {
      const resolve = waiting.shift();

      if (resolve) resolve(answer);
    }
  };
};

const setup = (options: { running?: boolean } = {}) => {
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };
  const state = createMockState();
  const log = createMockLog();
  const deps = createMockDeps(() => options.running ?? false);
  const gateStub = createGateStub();
  const ctx: FlowCtx = {
    global: {},
    config,
    state,
    emit: vi.fn(),
    log,
    require: refuseRequire,
    deps
  };

  return { api: createFxApi(ctx, { gate: gateStub.gate }), ctx, gateStub, log, state };
};

// ─── createFxState ────────────────────────────────────────────

describe("createFxState", () => {
  it("starts with no handler, no hint, no completion and live mode", () => {
    const state = createFxState();

    expect(state.handlers.size).toBe(0);
    expect(state.buffered).toEqual([]);
    expect(state.settled).toEqual([]);
    expect(state.mode).toBe("live");
  });

  it("returns a fresh state each call", () => {
    const first = createFxState();
    const second = createFxState();

    first.buffered.push({ kind: "sparkle", hint: true });

    expect(second.buffered).toEqual([]);
  });
});

// ─── handle ───────────────────────────────────────────────────

describe("handle", () => {
  it("registers one handler per kind", () => {
    const { api, state } = setup();

    api.handle("sfx", vi.fn());

    expect(state.fx.handlers.has("sfx")).toBe(true);
  });

  it("defaults runInFast to false", () => {
    const { api, state } = setup();

    api.handle("sfx", vi.fn());

    expect(state.fx.handlers.get("sfx")?.runInFast).toBe(false);
  });

  it("keeps runInFast when it is asked for", () => {
    const { api, state } = setup();

    api.handle("load", vi.fn(), { runInFast: true });

    expect(state.fx.handlers.get("load")?.runInFast).toBe(true);
  });

  it("throws for a second handler of one kind", () => {
    const { api } = setup();

    api.handle("sfx", vi.fn());

    expect(() => api.handle("sfx", vi.fn())).toThrow(/^\[game] /);
  });

  it("names the kind and what to do in the error", () => {
    const { api } = setup();

    api.handle("sfx", vi.fn());

    expect(() => api.handle("sfx", vi.fn())).toThrow(/"sfx"[\S\s]*\n {2}\S.*\.$/);
  });

  it("returns an unregister function that frees the kind", () => {
    const { api, state } = setup();

    const off = api.handle("sfx", vi.fn());
    off();

    expect(state.fx.handlers.has("sfx")).toBe(false);
    expect(() => api.handle("sfx", vi.fn())).not.toThrow();
  });

  it("unregisters only its own handler", () => {
    const { api, state } = setup();
    const second = vi.fn();

    const off = api.handle("sfx", vi.fn());
    off();
    api.handle("sfx", second);
    off();

    expect(state.fx.handlers.get("sfx")?.run).toBe(second);
  });
});

// ─── dispatch ─────────────────────────────────────────────────

describe("dispatch", () => {
  it("delivers the descriptor to the handler of its kind", () => {
    const { api } = setup();
    const play = vi.fn();

    api.handle("sfx", play);
    api.dispatch({ kind: "sfx", payload: { name: "pop" } });

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[0]).toEqual({ kind: "sfx", payload: { name: "pop" } });
  });

  it("passes a signal and the current mode to the handler", () => {
    const { api } = setup();
    const play = vi.fn();

    api.handle("sfx", play);
    api.dispatch({ kind: "sfx" });

    const handlerCtx = play.mock.calls[0]?.[1];

    expect(handlerCtx.mode).toBe("live");
    expect(handlerCtx.signal.aborted).toBe(false);
  });

  it("does nothing when no handler is registered", () => {
    const { api } = setup();

    expect(() => api.dispatch({ kind: "sfx" })).not.toThrow();
  });

  it("logs a thrown handler error instead of throwing it", () => {
    const { api, log } = setup();

    api.handle("sfx", () => {
      throw new Error("no audio device");
    });

    expect(() => api.dispatch({ kind: "sfx" })).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("logs a rejected handler promise", async () => {
    const { api, log } = setup();

    api.handle("sfx", () => Promise.reject(new Error("no audio device")));
    api.dispatch({ kind: "sfx" });
    await tick();

    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("delivers a hint like any other descriptor", () => {
    const { api } = setup();
    const sparkle = vi.fn();

    api.handle("sparkle", sparkle);
    api.dispatch(hint("sparkle", { cell: "c3" }));

    expect(sparkle).toHaveBeenCalledTimes(1);
  });
});

// ─── run: live mode ───────────────────────────────────────────

describe("run in live mode", () => {
  it("resolves with the value of the handler", async () => {
    const { api } = setup();

    api.handle("play", () => "done");

    await expect(api.run({ kind: "play" }, signal())).resolves.toBe("done");
  });

  it("awaits an asynchronous handler", async () => {
    const { api } = setup();

    api.handle("play", async () => {
      await tick();
      return "late";
    });

    await expect(api.run({ kind: "play" }, signal())).resolves.toBe("late");
  });

  it("resolves undefined when no handler is registered", async () => {
    const { api } = setup();

    await expect(api.run({ kind: "music" }, signal())).resolves.toBeUndefined();
  });

  it("passes the node signal and the mode to the handler", async () => {
    const { api } = setup();
    const controller = new AbortController();
    const play: FxHandler = vi.fn();

    api.handle("play", play);
    await api.run({ kind: "play" }, controller.signal);

    expect(play).toHaveBeenCalledWith(
      { kind: "play" },
      {
        signal: controller.signal,
        mode: "live"
      }
    );
  });

  it("rejects with the handler error", async () => {
    const { api } = setup();

    api.handle("play", () => Promise.reject(new Error("broken")));

    await expect(api.run({ kind: "play" }, signal())).rejects.toThrow("broken");
  });

  it("swallows the error of a cosmetic descriptor", async () => {
    const { api } = setup();

    api.handle("shake", () => {
      throw new Error("no screen");
    });

    await expect(api.run({ kind: "shake", cosmetic: true }, signal())).resolves.toBeUndefined();
  });
});

// ─── run: fast mode ───────────────────────────────────────────

describe("run in fast mode", () => {
  it("resolves undefined without calling the handler", async () => {
    const { api } = setup();
    const play = vi.fn();

    api.handle("play", play);
    api.setMode("fast");

    await expect(api.run({ kind: "play" }, signal())).resolves.toBeUndefined();
    expect(play).not.toHaveBeenCalled();
  });

  it("calls a handler registered with runInFast and resolves with its value", async () => {
    const { api } = setup();
    const load = vi.fn(() => "loaded");

    api.handle("load", load, { runInFast: true });
    api.setMode("fast");

    await expect(api.run({ kind: "load" }, signal())).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reports the fast mode to a runInFast handler", async () => {
    const { api } = setup();
    const load: FxHandler = vi.fn();

    api.handle("load", load, { runInFast: true });
    api.setMode("fast");
    await api.run({ kind: "load" }, signal());

    expect(load).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "fast" }));
  });

  it("returns to live behaviour after setMode('live')", async () => {
    const { api } = setup();
    const play = vi.fn(() => "played");

    api.handle("play", play);
    api.setMode("fast");
    await api.run({ kind: "play" }, signal());
    api.setMode("live");

    await expect(api.run({ kind: "play" }, signal())).resolves.toBe("played");
  });
});

// ─── run: descriptors with answers ────────────────────────────

describe("run with answers", () => {
  it("opens the gate for the allowed intents and resolves with the answer", async () => {
    const { api, gateStub } = setup();

    const pending = api.run({ kind: "popup", answers: ["again", "home"] }, signal());
    await tick();

    expect(gateStub.opened).toEqual([{ allowed: ["again", "home"] }]);

    gateStub.reply({ intent: "home" });

    await expect(pending).resolves.toEqual({ intent: "home" });
  });

  it("calls the handler in live mode so the UI is shown", async () => {
    const { api, gateStub } = setup();
    const popup = vi.fn();

    api.handle("popup", popup);
    const pending = api.run({ kind: "popup", answers: ["again"] }, signal());
    await tick();
    gateStub.reply({ intent: "again" });
    await pending;

    expect(popup).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler in fast mode but still waits for the answer", async () => {
    const { api, gateStub } = setup();
    const popup = vi.fn();

    api.handle("popup", popup);
    api.setMode("fast");
    const pending = api.run({ kind: "popup", answers: ["again"] }, signal());
    await tick();

    expect(popup).not.toHaveBeenCalled();
    expect(gateStub.opened).toEqual([{ allowed: ["again"] }]);

    gateStub.reply({ intent: "again", payload: { slot: 2 } });

    await expect(pending).resolves.toEqual({ intent: "again", payload: { slot: 2 } });
  });

  it("logs a failing UI handler and still resolves with the answer", async () => {
    const { api, gateStub, log } = setup();

    api.handle("popup", () => {
      throw new Error("no renderer");
    });
    const pending = api.run({ kind: "popup", answers: ["again"] }, signal());
    await tick();
    gateStub.reply({ intent: "again" });

    await expect(pending).resolves.toEqual({ intent: "again" });
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

// ─── completion order ─────────────────────────────────────────

describe("completion order", () => {
  it("resolves immediately when the frame loop is not running", async () => {
    const { api } = setup({ running: false });

    api.handle("play", () => "now");

    await expect(api.run({ kind: "play" }, signal())).resolves.toBe("now");
  });

  it("holds a completion until the signals phase while the frame loop runs", async () => {
    const { api } = setup({ running: true });
    const done = vi.fn();

    api.handle("play", () => "value");
    api.run({ kind: "play" }, signal()).then(done);
    await tick();

    expect(done).not.toHaveBeenCalled();

    api.flushSettled();
    await tick();

    expect(done).toHaveBeenCalledWith("value");
  });

  it("resolves two completions of one frame in start order", async () => {
    const { api } = setup({ running: true });
    const order: string[] = [];
    const slow = new Promise<string>(resolve => {
      setTimeout(() => resolve("slow"), 0);
    });

    api.handle("slow", () => slow);
    api.handle("quick", () => "quick");

    const first = api.run({ kind: "slow" }, signal()).then(() => order.push("slow"));
    const second = api.run({ kind: "quick" }, signal()).then(() => order.push("quick"));

    await slow;
    await tick();
    api.flushSettled();
    await Promise.all([first, second]);

    expect(order).toEqual(["slow", "quick"]);
  });

  it("keeps an unsettled effect queued across a flush", async () => {
    const { api } = setup({ running: true });
    const { promise, resolve } = Promise.withResolvers<string>();
    const done = vi.fn();

    api.handle("play", () => promise);
    api.run({ kind: "play" }, signal()).then(done);
    api.flushSettled();
    await tick();

    expect(done).not.toHaveBeenCalled();

    resolve("later");
    await tick();
    api.flushSettled();
    await tick();

    expect(done).toHaveBeenCalledWith("later");
  });

  it("rejects a queued failure in the signals phase", async () => {
    const { api } = setup({ running: true });

    api.handle("play", () => Promise.reject(new Error("broken")));
    const pending = api.run({ kind: "play" }, signal());
    await tick();
    api.flushSettled();

    await expect(pending).rejects.toThrow("broken");
  });

  it("does nothing when nothing is queued", () => {
    const { api } = setup({ running: true });

    expect(() => api.flushSettled()).not.toThrow();
  });

  it("does not queue in fast mode", async () => {
    const { api } = setup({ running: true });

    api.handle("load", () => "loaded", { runInFast: true });
    api.setMode("fast");

    await expect(api.run({ kind: "load" }, signal())).resolves.toBe("loaded");
  });
});

// ─── hints ────────────────────────────────────────────────────

describe("hints", () => {
  it("buffers a hint instead of dispatching it", () => {
    const { api, state } = setup();
    const sparkle = vi.fn();

    api.handle("sparkle", sparkle);
    api.buffer(hint("sparkle", { cell: "c3" }));

    expect(sparkle).not.toHaveBeenCalled();
    expect(state.fx.buffered).toEqual([{ kind: "sparkle", payload: { cell: "c3" }, hint: true }]);
  });

  it("dispatches buffered hints in order on release", () => {
    const { api } = setup();
    const seen: string[] = [];

    api.handle("sparkle", descriptor => {
      seen.push(JSON.stringify(descriptor.payload));
    });
    api.buffer(hint("sparkle", { cell: "c1" }));
    api.buffer(hint("sparkle", { cell: "c2" }));
    api.release();

    expect(seen).toEqual(['{"cell":"c1"}', '{"cell":"c2"}']);
  });

  it("empties the buffer on release", () => {
    const { api, state } = setup();

    api.handle("sparkle", vi.fn());
    api.buffer(hint("sparkle"));
    api.release();
    api.release();

    expect(state.fx.buffered).toEqual([]);
  });

  it("drops buffered hints without dispatching them", () => {
    const { api, state } = setup();
    const sparkle = vi.fn();

    api.handle("sparkle", sparkle);
    api.buffer(hint("sparkle"));
    api.drop();
    api.release();

    expect(sparkle).not.toHaveBeenCalled();
    expect(state.fx.buffered).toEqual([]);
  });

  it("drops hints in fast mode", () => {
    const { api, state } = setup();
    const sparkle = vi.fn();

    api.handle("sparkle", sparkle);
    api.setMode("fast");
    api.buffer(hint("sparkle"));
    api.release();

    expect(state.fx.buffered).toEqual([]);
    expect(sparkle).not.toHaveBeenCalled();
  });
});

// ─── descriptors ──────────────────────────────────────────────

describe("hint", () => {
  it("builds plain data flagged as a hint", () => {
    expect(hint("sparkle", { cell: "c3" })).toEqual({
      kind: "sparkle",
      payload: { cell: "c3" },
      hint: true
    });
  });

  it("omits the payload key when there is no payload", () => {
    expect(Object.keys(hint("sparkle"))).toEqual(["kind", "hint"]);
  });
});

describe("schedule", () => {
  it("carries the moment of the next due timer", () => {
    const descriptor: Descriptor = schedule(1_700_000_000_000);

    expect(descriptor.kind).toBe("schedule");
    expect(descriptor.payload).toEqual({ moment: 1_700_000_000_000 });
  });

  it("carries null when nothing is due", () => {
    expect(schedule(undefined).payload).toEqual({});
  });

  it("never asks for an answer", () => {
    expect(schedule(1000).answers).toBeUndefined();
  });
});

describe("guide", () => {
  it("carries the allowed answer", () => {
    const descriptor = guide({ allow: { intent: "merge", payload: { from: "c2", to: "c3" } } });

    expect(descriptor.kind).toBe("guide");
    expect(descriptor.payload).toEqual({
      allow: { intent: "merge", payload: { from: "c2", to: "c3" } }
    });
  });

  it("copies the visual part when it is given", () => {
    const descriptor = guide({
      allow: { intent: "merge" },
      highlight: ["c2", "c3"],
      hand: "drag",
      text: "Merge them"
    });

    expect(descriptor.payload).toEqual({
      allow: { intent: "merge" },
      highlight: ["c2", "c3"],
      hand: "drag",
      text: "Merge them"
    });
  });

  it("copies the highlight list so the caller cannot change it later", () => {
    const highlight = ["c2"];
    const descriptor = guide({ allow: { intent: "merge" }, highlight });

    highlight.push("c9");

    expect(descriptor.payload).toEqual({ allow: { intent: "merge" }, highlight: ["c2"] });
  });
});
