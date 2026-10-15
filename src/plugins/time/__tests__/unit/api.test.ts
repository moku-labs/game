import type { Log } from "@moku-labs/common/browser";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createTimeApi, PHASES, tickFrame } from "../../api";
import { createTimeState } from "../../state";
import type { Api, Config, Phase, Time, TimeCtx } from "../../types";
import { createScript } from "./rate-script";

const global = { orientation: "portrait", referenceSide: 1080 };

function createLogMock(): Log.LogApi {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
    // Partial mock of a complex external type: only `error` is exercised here.
  } as unknown as Log.LogApi;
}

function createCtx(overrides: Partial<Config> = {}): TimeCtx {
  const config: Config = {
    maxFps: 60,
    maxDeltaMs: 50,
    idleFps: 30,
    idleAfterMs: 2000,
    adaptive: false,
    ...overrides
  };

  return {
    global,
    config,
    state: createTimeState({ config }),
    emit: vi.fn(),
    log: createLogMock()
  };
}

function createApi(overrides: Partial<Config> = {}): { api: Api; ctx: TimeCtx } {
  const ctx = createCtx(overrides);

  return { api: createTimeApi(ctx), ctx };
}

function driveFrames(ctx: TimeCtx, from: number, count: number, stepMs = 16): number {
  let timestamp = from;

  for (let index = 0; index < count; index += 1) {
    timestamp += stepMs;
    tickFrame(ctx, timestamp);
  }

  return timestamp;
}

/** Ticks once at `from`, then `rounds` times through `intervals`; answers how many ticks it made. */
function driveIntervals(
  ctx: TimeCtx,
  from: number,
  intervals: readonly number[],
  rounds: number
): number {
  let timestamp = from;
  let ticks = 1;

  tickFrame(ctx, timestamp);

  for (let round = 0; round < rounds; round += 1) {
    for (const interval of intervals) {
      timestamp += interval;
      tickFrame(ctx, timestamp);
      ticks += 1;
    }
  }

  return ticks;
}

// ─── onFrame ──────────────────────────────────────────────────

describe("onFrame", () => {
  it("runs the phases in the fixed order", () => {
    const { api } = createApi();
    const seen: Phase[] = [];

    for (const phase of PHASES.toReversed()) {
      api.onFrame(phase, () => seen.push(phase));
    }
    api.step(16);

    expect(seen).toEqual([...PHASES]);
  });

  it("runs the callbacks of one phase in registration order", () => {
    const { api } = createApi();
    const seen: string[] = [];

    api.onFrame("animate", () => seen.push("first"));
    api.onFrame("animate", () => seen.push("second"));
    api.onFrame("animate", () => seen.push("third"));
    api.step(16);

    expect(seen).toEqual(["first", "second", "third"]);
  });

  it("stops calling a callback after its unsubscribe", () => {
    const { api } = createApi();
    const callback = vi.fn();

    const off = api.onFrame("render", callback);
    api.step(16);
    off();
    api.step(16);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ignores a second unsubscribe", () => {
    const { api, ctx } = createApi();

    const off = api.onFrame("render", vi.fn());
    off();
    off();

    expect(ctx.state.callbacks.render).toEqual([]);
  });

  it("takes a callback registered during a frame into account from the next frame", () => {
    const { api } = createApi();
    const late = vi.fn();

    const off = api.onFrame("input", () => api.onFrame("render", late));
    api.step(16);

    expect(late).not.toHaveBeenCalled();

    off();
    api.step(16);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("hands the current Time to the callback", () => {
    const { api } = createApi();
    const seen: Time[] = [];

    api.onFrame("animate", time => seen.push({ ...time }));
    api.step(20);

    expect(seen).toEqual([{ delta: 20, elapsed: 20, scale: 1, frame: 1, idle: false }]);
  });
});

// ─── read ─────────────────────────────────────────────────────

describe("read", () => {
  it("returns the current Time", () => {
    const { api } = createApi();

    api.step(16);
    api.step(4);

    expect(api.snapshot()).toEqual({ delta: 4, elapsed: 20, scale: 1, frame: 2, idle: false });
  });

  it("returns a snapshot, so a later frame does not change it", () => {
    const { api, ctx } = createApi();

    const before = api.snapshot();
    ctx.state.time.elapsed = 999;

    expect(before.elapsed).toBe(0);
  });
});

// ─── setScale ─────────────────────────────────────────────────

describe("setScale", () => {
  it("multiplies the delta by the scale", () => {
    const { api } = createApi();

    api.setScale(0.5);
    api.step(20);

    expect(api.snapshot()).toMatchObject({ delta: 10, elapsed: 10, scale: 0.5 });
  });

  it("freezes time at scale 0", () => {
    const { api } = createApi();

    api.setScale(0);
    api.step(100);

    expect(api.snapshot()).toMatchObject({ delta: 0, elapsed: 0, frame: 1 });
  });

  it("clamps a negative scale to zero", () => {
    const { api } = createApi();

    api.setScale(-2);

    expect(api.snapshot().scale).toBe(0);
  });
});

// ─── pause and resume ─────────────────────────────────────────

describe("pause and resume", () => {
  it("reports the pause flag", () => {
    const { api } = createApi();

    expect(api.isPaused()).toBe(false);

    api.pause();

    expect(api.isPaused()).toBe(true);

    api.resume();

    expect(api.isPaused()).toBe(false);
  });

  it("runs no phase and does not advance elapsed while paused", () => {
    const { api, ctx } = createApi();
    const callback = vi.fn();

    api.onFrame("animate", callback);
    api.pause();
    tickFrame(ctx, 100);
    tickFrame(ctx, 200);

    expect(callback).not.toHaveBeenCalled();
    expect(api.snapshot()).toMatchObject({ elapsed: 0, frame: 0 });
  });

  it("gives the first frame after a resume a normal delta", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    api.pause();
    api.resume();
    tickFrame(ctx, 60_000);

    expect(api.snapshot().delta).toBe(1000 / 60);
  });

  it("still steps while paused", () => {
    const { api } = createApi();
    const callback = vi.fn();

    api.onFrame("animate", callback);
    api.pause();
    api.step(16);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ─── isRunning ────────────────────────────────────────────────

describe("isRunning", () => {
  it("is false while no frame source drives the loop", () => {
    const { api } = createApi();

    expect(api.isRunning()).toBe(false);
  });

  it("follows the running flag of the state", () => {
    const { api, ctx } = createApi();

    ctx.state.running = true;

    expect(api.isRunning()).toBe(true);
  });
});

// ─── step ─────────────────────────────────────────────────────

describe("step", () => {
  it("runs exactly one frame with the given delta, ignoring maxDeltaMs", () => {
    const { api } = createApi();

    api.step(1000);

    expect(api.snapshot()).toEqual({ delta: 1000, elapsed: 1000, scale: 1, frame: 1, idle: false });
  });

  it("ignores the fps cap", () => {
    const { api } = createApi();

    api.step(1);
    api.step(1);
    api.step(1);

    expect(api.snapshot().frame).toBe(3);
  });

  it("throws while a frame runs", () => {
    const { api, ctx } = createApi();

    ctx.state.stepping = true;

    expect(() => api.step(16)).toThrow(
      "[game] time.step() called inside a frame.\n  Call it from outside a frame callback."
    );
  });

  it("throws when a frame callback calls it", () => {
    const { api } = createApi();
    const caught: unknown[] = [];

    api.onFrame("input", () => {
      try {
        api.step(16);
      } catch (error) {
        caught.push(error);
      }
    });
    api.step(16);

    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(Error);
  });

  it("leaves the frame guard open after a throwing frame", () => {
    const { api, ctx } = createApi();

    const off = api.onFrame("input", () => {
      throw new Error("boom");
    });
    api.step(16);
    off();

    expect(ctx.state.stepping).toBe(false);
  });
});

// ─── tickFrame ────────────────────────────────────────────────

describe("tickFrame", () => {
  it("uses one capped frame as the delta of the very first frame", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 12_345);

    expect(api.snapshot()).toMatchObject({ delta: 1000 / 60, frame: 1 });
  });

  it("uses the gap between two timestamps as the delta", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1020);

    expect(api.snapshot()).toMatchObject({ delta: 20, frame: 2 });
  });

  it("clamps the delta at maxDeltaMs", () => {
    const { api, ctx } = createApi({ maxDeltaMs: 50 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 6000);

    expect(api.snapshot().delta).toBe(50);
  });

  it("skips a frame that arrives before the fps cap allows it", () => {
    const { api, ctx } = createApi({ maxFps: 30 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1010);

    expect(api.snapshot().frame).toBe(1);

    tickFrame(ctx, 1040);

    expect(api.snapshot()).toMatchObject({ frame: 2, delta: 40 });
  });

  it("runs every frame of a 120 Hz source when the cap is 120", () => {
    const { api, ctx } = createApi({ maxFps: 120 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1008);
    tickFrame(ctx, 1016);

    expect(api.snapshot()).toMatchObject({ frame: 3, delta: 8 });
  });

  it("halves a 120 Hz source under the default cap of 60", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1008);
    tickFrame(ctx, 1016);

    expect(api.snapshot()).toMatchObject({ frame: 2, delta: 16 });
  });

  it("applies the scale to a real frame", () => {
    const { api, ctx } = createApi();

    api.setScale(2);
    tickFrame(ctx, 1000);
    tickFrame(ctx, 1020);

    expect(api.snapshot()).toMatchObject({ delta: 40 });
  });
});

// ─── the cap's slack ──────────────────────────────────────────

describe("the cap's slack", () => {
  it("vsync jitter of a 60 Hz panel (15.6 to 17.7 ms) skips no frame under a 60 cap", () => {
    const { api, ctx } = createApi();
    const ticks = driveIntervals(ctx, 1000, [16.7, 15.6, 16.6, 17.7, 16.5, 15.7, 16.8, 17.6], 10);

    expect(api.snapshot().frame).toBe(ticks);
  });

  it("a 120 Hz panel with a millisecond of jitter runs every second tick under a 60 cap", () => {
    const { api, ctx } = createApi();
    const ticks = driveIntervals(ctx, 1000, [7.4, 7.6, 8.3, 8.4, 9.2, 9.1, 8.2, 8.5], 10);

    expect(api.snapshot().frame).toBe((ticks + 1) / 2);
  });

  it("a 144 Hz panel under a 60 cap runs every third tick, 48 fps, never every second", () => {
    const { api, ctx } = createApi();
    const ticks = driveIntervals(ctx, 1000, [1000 / 144], 150);

    expect(api.snapshot().frame).toBe((ticks - 1) / 3 + 1);
  });
});

// ─── the idle cap ─────────────────────────────────────────────

describe("the idle cap", () => {
  it("stays awake while the wakes keep coming", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    driveFrames(ctx, 1000, 6);

    expect(api.snapshot().idle).toBe(false);
  });

  it("goes idle after idleAfterMs of unscaled time without a wake", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    driveFrames(ctx, 1000, 7);

    expect(api.snapshot().idle).toBe(true);
  });

  it("skips the frames of a 60 Hz source down to idleFps once idle", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });
    const last = driveFrames(ctx, 1000, 7);
    const frames = api.snapshot().frame;

    tickFrame(ctx, last + 16);

    expect(api.snapshot().frame).toBe(frames);

    tickFrame(ctx, last + 48);

    expect(api.snapshot()).toMatchObject({ frame: frames + 1, delta: 48 });
  });

  it("runs at maxFps again after a wake", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });
    const last = driveFrames(ctx, 1000, 7);
    const frames = api.snapshot().frame;

    api.wake();

    expect(api.snapshot().idle).toBe(false);

    tickFrame(ctx, last + 16);

    expect(api.snapshot().frame).toBe(frames + 1);
  });

  it("goes idle again when the next wake stays away", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });
    const last = driveFrames(ctx, 1000, 7);

    api.wake();
    driveFrames(ctx, last, 7);

    expect(api.snapshot().idle).toBe(true);
  });

  it("never skips a frame when the idle cap is off", () => {
    const { api, ctx } = createApi({ idleFps: 0, idleAfterMs: 100 });

    driveFrames(ctx, 1000, 20);

    expect(api.snapshot()).toMatchObject({ frame: 20, idle: false });
  });

  it("a page throttled to 1 Hz goes idle after two frames, while its delta stays clamped", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    tickFrame(ctx, 2000);

    expect(api.snapshot()).toMatchObject({ idle: false, delta: 50 });

    tickFrame(ctx, 3000);

    expect(api.snapshot()).toMatchObject({ idle: true, delta: 50 });
  });

  it("keeps the idle timer running while the time scale is zero", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    api.setScale(0);
    driveFrames(ctx, 1000, 7);

    expect(api.snapshot()).toMatchObject({ elapsed: 0, idle: true });
  });

  it("counts a resume as a wake", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    driveFrames(ctx, 1000, 7);
    api.pause();
    api.resume();

    expect(api.snapshot().idle).toBe(false);
  });

  it("leaves step alone while idle", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    driveFrames(ctx, 1000, 7);
    const frames = api.snapshot().frame;

    api.step(1);
    api.step(1);

    expect(api.snapshot().frame).toBe(frames + 2);
  });
});

// ─── wake ─────────────────────────────────────────────────────

describe("wake", () => {
  it("is safe inside a frame callback", () => {
    const { api } = createApi({ idleAfterMs: 100 });

    api.onFrame("input", () => api.wake());

    expect(() => api.step(16)).not.toThrow();
    expect(api.snapshot().idle).toBe(false);
  });

  it("is idempotent", () => {
    const { api, ctx } = createApi({ idleAfterMs: 100 });

    driveFrames(ctx, 1000, 7);
    api.wake();
    api.wake();

    expect(ctx.state.lastWakeMs).toBe(ctx.state.unscaledElapsedMs);
    expect(api.snapshot().idle).toBe(false);
  });

  it("runs no frame of its own", () => {
    const { api } = createApi({ idleAfterMs: 100 });

    api.wake();

    expect(api.snapshot().frame).toBe(0);
  });
});

// ─── failing callbacks ────────────────────────────────────────

describe("a throwing frame callback", () => {
  it("does not stop the other callbacks", () => {
    const { api } = createApi();
    const after = vi.fn();
    const otherPhase = vi.fn();

    api.onFrame("animate", () => {
      throw new Error("boom");
    });
    api.onFrame("animate", after);
    api.onFrame("render", otherPhase);
    api.step(16);

    expect(after).toHaveBeenCalledTimes(1);
    expect(otherPhase).toHaveBeenCalledTimes(1);
  });

  it("is reported with its phase and error", () => {
    const { api, ctx } = createApi();
    const failure = new Error("boom");

    api.onFrame("layout", () => {
      throw failure;
    });
    api.step(16);

    expect(ctx.log.error).toHaveBeenCalledWith("time: frame callback failed", {
      phase: "layout",
      error: failure
    });
  });
});

// ─── types ────────────────────────────────────────────────────

describe("time api types", () => {
  it("accepts only the six phases", () => {
    const { api } = createApi();

    expectTypeOf(api.onFrame).parameter(0).toEqualTypeOf<Phase>();
    // @ts-expect-error — "foo" is not a frame phase
    expectTypeOf(api.onFrame).toBeCallableWith("foo", () => {});

    expect(api.snapshot().frame).toBe(0);
  });

  it("hands the callback a readonly Time", () => {
    const { api } = createApi();
    const seen: number[] = [];

    api.onFrame("animate", time => {
      expectTypeOf(time).toEqualTypeOf<Readonly<Time>>();
      seen.push(time.delta);
    });
    api.step(16);

    expect(seen).toEqual([16]);
  });

  it("hands out a Time that may not be written to", () => {
    const { api } = createApi();

    const time = api.snapshot();
    // @ts-expect-error — the Time handed out by the api is readonly
    time.elapsed = 1;

    expect(api.snapshot().elapsed).toBe(0);
  });

  it("returns an unsubscribe function from onFrame", () => {
    const { api } = createApi();

    expectTypeOf(api.onFrame).returns.toEqualTypeOf<() => void>();
    expectTypeOf(api.snapshot).returns.toEqualTypeOf<Readonly<Time>>();
    expectTypeOf(api.wake).toEqualTypeOf<() => void>();

    expect(typeof api.onFrame("sync", () => {})).toBe("function");
  });
});

// ─── wakes, the count the renderer reads ──────────────────────

describe("wakes", () => {
  it("grows by one per wake and per resume, not per step", () => {
    const { api } = createApi();

    expect(api.wakes()).toBe(0);

    api.wake();
    api.wake();
    api.step(16);
    api.pause();
    api.resume();

    expect(api.wakes()).toBe(3);
  });
});

// ─── the frame rate: rate() and setRate ───────────────────────

describe("setRate", () => {
  it("forces the exact cap, and the rule leaves it alone", () => {
    const s = createScript();

    s.play(2000);

    expect(s.api.setRate(60)).toMatchObject({
      fps: 60,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      ladder: [120, 60]
    });

    s.play(6000);
    const before = s.api.snapshot().frame;

    s.play(1000);

    // 60 frames a second on a 120 Hz display, and no return after the dwell.
    expect(s.api.snapshot().frame - before).toBeGreaterThanOrEqual(59);
    expect(s.api.snapshot().frame - before).toBeLessThanOrEqual(61);
    expect(s.api.rate()).toMatchObject({ fps: 60, mode: "forced" });

    s.api.setRate(120);
    s.gaps(17, 30);
    expect(s.api.rate()).toMatchObject({ fps: 120, mode: "forced" });
  });

  it("never forces above maxFps", () => {
    const s = createScript({ config: { maxFps: 60, adaptive: false } });

    expect(s.api.setRate(120)).toMatchObject({ fps: 60, mode: "forced" });
  });

  it("auto goes back to the top of the ladder, or to maxFps without adaptive", () => {
    const adaptive = createScript();
    const fixed = createScript({ config: { maxFps: 60, adaptive: false } });

    adaptive.play(2000);
    adaptive.api.setRate(60);
    fixed.api.setRate(30);

    expect(adaptive.api.setRate("auto")).toMatchObject({ fps: 120, mode: "auto", reason: "auto" });
    expect(fixed.api.setRate("auto")).toMatchObject({ fps: 60, mode: "fixed", reason: "auto" });
    expect(adaptive.changes().map(change => [change.from, change.to, change.mode])).toEqual([
      [120, 60, "forced"],
      [60, 120, "auto"]
    ]);
  });

  it("a choice equal to the current one changes nothing and emits nothing", () => {
    const adaptive = createScript();
    const fixed = createScript({ config: { maxFps: 60, adaptive: false } });
    const before = adaptive.api.rate();

    adaptive.api.setRate("auto");
    fixed.api.setRate("auto");
    adaptive.api.setRate(60);
    adaptive.api.setRate(60);

    expect(adaptive.changes()).toHaveLength(1);
    expect(fixed.changes()).toEqual([]);
    expect(before).toMatchObject({ mode: "auto", reason: "start" });
  });

  it("refuses 90 with the message naming the choices", () => {
    const { api } = createApi();

    expect(() => api.setRate(90 as never)).toThrow(
      '[game] time.setRate takes "auto", 30, 60 or 120.\n  Pass one of them, not 90.'
    );
    expect(api.rate().fps).toBe(60);
  });
});

describe("rate", () => {
  it("is the same frozen object until something changes", () => {
    const s = createScript();
    const first = s.api.rate();

    s.gaps(1000 / 120, 100);

    expect(s.api.rate()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    s.api.setRate(60);
    expect(s.api.rate()).not.toBe(first);
  });
});
