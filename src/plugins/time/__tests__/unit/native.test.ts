/* eslint-disable unicorn/no-null -- the thermal reading is JSON: a field the shell left out is null. */
import type { Log } from "@moku-labs/common/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTime, stopTime } from "../../lifecycle";
import { nativeShell, readingOf, whenShellReady } from "../../native";
import { createTimeState } from "../../state";
import type { Config, TimeCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the one reader of `__MOKU_NATIVE__` (spec 11 T2): the frame rate the
// panel is asked for, the one thermal listener, the shell's readiness.
// ---------------------------------------------------------------------------

const config: Config = {
  maxFps: 60,
  maxDeltaMs: 50,
  idleFps: 30,
  idleAfterMs: 2000,
  adaptive: false
};

function createCtx(): TimeCtx {
  return {
    global: {},
    config,
    state: createTimeState({ config }),
    emit: vi.fn(),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Log.LogApi
  };
}

/** A window as an event target, as the page has one. */
function stubWindow(): { add: ReturnType<typeof vi.fn>; dispatch(detail: unknown): void } {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const add = vi.fn((type: string, listener: (event: Event) => void) => {
    const set = listeners.get(type) ?? new Set();

    set.add(listener);
    listeners.set(type, set);
  });

  vi.stubGlobal("addEventListener", add);
  vi.stubGlobal("removeEventListener", (type: string, listener: (event: Event) => void) => {
    listeners.get(type)?.delete(listener);
  });

  return {
    add,
    dispatch: detail => {
      for (const listener of listeners.get("moku-native:thermal") ?? []) {
        listener(Object.assign(new Event("moku-native:thermal"), { detail }));
      }
    }
  };
}

function stubShell(shell: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const setFrameRate = vi.fn(() => ({ panelHz: 60, maxHz: 120 }));

  vi.stubGlobal("__MOKU_NATIVE__", { version: 1, display: { setFrameRate, maxHz: 120 }, ...shell });

  return setFrameRate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the frame rate of the native shell", () => {
  it("asks the shell for maxFps once at start and hands the request back at stop", () => {
    const setFrameRate = stubShell({});
    const ctx = createCtx();

    startTime(ctx);
    stopTime(ctx.state);
    stopTime(ctx.state);

    expect(setFrameRate.mock.calls).toEqual([[60], [null]]);
  });

  it("asks nothing of a shell of another version, without display, or on a browser page", () => {
    for (const global of [
      { version: 2, display: { setFrameRate: vi.fn() } },
      { version: 1 },
      undefined
    ]) {
      vi.stubGlobal("__MOKU_NATIVE__", global);
      const ctx = createCtx();

      startTime(ctx);
      stopTime(ctx.state);

      expect(nativeShell()).toBeUndefined();
      expect(ctx.log.warn).not.toHaveBeenCalled();
    }
  });

  it("warns once when the shell throws or rejects, and the app runs on", async () => {
    const ctx = createCtx();
    const setFrameRate = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("no display");
      })
      .mockImplementationOnce(() => Promise.reject(new Error("refused")));

    vi.stubGlobal("__MOKU_NATIVE__", { version: 1, display: { setFrameRate } });
    startTime(ctx);
    stopTime(ctx.state);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("time: the native frame rate failed", {
      error: new Error("no display")
    });
  });

  it("reads the shell's fields: the panel's top rate, the device and the thermal reader", () => {
    const read = vi.fn(() => ({ status: 1 }));

    stubShell({
      device: { model: "SM-A266B", manufacturer: "samsung", sdk: 35 },
      thermal: { read }
    });
    const shell = nativeShell();

    expect(shell?.display.maxHz).toBe(120);
    expect(shell?.device).toEqual({ model: "SM-A266B", manufacturer: "samsung", sdk: 35 });
    expect(shell?.thermal?.read()).toEqual({ status: 1 });
    expect(shell?.ready).toBeUndefined();
  });
});

describe("the one thermal listener", () => {
  it("emits time:thermal for each moku-native:thermal event of the shell, and nothing after stop", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    stubShell({});
    const window = stubWindow();
    const ctx = createCtx();

    startTime(ctx);
    window.dispatch({ status: 2, headroom: 0.71 });
    stopTime(ctx.state);
    window.dispatch({ status: 3 });

    expect(window.add).toHaveBeenCalledTimes(1);
    expect(window.add.mock.calls[0]?.[0]).toBe("moku-native:thermal");
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("time:thermal", {
      status: 2,
      headroom: 0.71,
      at: null,
      android: null
    });
  });

  it("adds no listener without the agent flag or without a shell", () => {
    const window = stubWindow();

    stubShell({});
    startTime(createCtx());
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_NATIVE__", undefined);
    startTime(createCtx());

    expect(window.add).not.toHaveBeenCalled();
  });
});

describe("readingOf", () => {
  it("keeps the fields the shell sent and makes the rest null", () => {
    expect(readingOf({ status: 2 })).toEqual({
      status: 2,
      headroom: null,
      at: null,
      android: null
    });
    expect(
      readingOf({
        status: "severe",
        headroom: 0.71,
        at: 1_791_986_090_000,
        android: { status: 2, headroom: 0.71, forecastSeconds: 10 }
      })
    ).toEqual({
      status: "severe",
      headroom: 0.71,
      at: 1_791_986_090_000,
      android: { status: 2, headroom: 0.71, forecastSeconds: 10 }
    });
    expect(readingOf("hot")).toEqual({ status: null, headroom: null, at: null, android: null });
  });
});

describe("whenShellReady", () => {
  it("settles when the shell answered, and after the timeout when it never does", async () => {
    vi.useFakeTimers();
    const settled: string[] = [];

    stubShell({ ready: Promise.resolve() });
    const answered = nativeShell();

    stubShell({ ready: new Promise(() => undefined) });
    const silent = nativeShell();

    if (answered === undefined || silent === undefined) throw new Error("no shell");

    const first = whenShellReady(answered, 500).then(() => settled.push("answered"));
    const second = whenShellReady(silent, 500).then(() => settled.push("silent"));

    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toEqual(["answered"]);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([first, second]);

    expect(settled).toEqual(["answered", "silent"]);
  });
});
