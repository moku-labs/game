import type { Log } from "@moku-labs/common/browser";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createTimeApi, PHASES, tickFrame } from "../../api";
import { createTimeState } from "../../state";
import type { Api, Config, Phase, Time, TimeCtx } from "../../types";

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
  const config: Config = { maxFps: 60, maxDeltaMs: 50, ...overrides };

  return {
    global,
    config,
    state: createTimeState({ global, config }),
    emit: vi.fn(),
    log: createLogMock()
  };
}

function createApi(overrides: Partial<Config> = {}): { api: Api; ctx: TimeCtx } {
  const ctx = createCtx(overrides);

  return { api: createTimeApi(ctx), ctx };
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

    expect(seen).toEqual([{ delta: 20, elapsed: 20, scale: 1, frame: 1 }]);
  });
});

// ─── read ─────────────────────────────────────────────────────

describe("read", () => {
  it("returns the current Time", () => {
    const { api } = createApi();

    api.step(16);
    api.step(4);

    expect(api.read()).toEqual({ delta: 4, elapsed: 20, scale: 1, frame: 2 });
  });

  it("returns a snapshot, so a later frame does not change it", () => {
    const { api, ctx } = createApi();

    const before = api.read();
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

    expect(api.read()).toMatchObject({ delta: 10, elapsed: 10, scale: 0.5 });
  });

  it("freezes time at scale 0", () => {
    const { api } = createApi();

    api.setScale(0);
    api.step(100);

    expect(api.read()).toMatchObject({ delta: 0, elapsed: 0, frame: 1 });
  });

  it("clamps a negative scale to zero", () => {
    const { api } = createApi();

    api.setScale(-2);

    expect(api.read().scale).toBe(0);
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
    expect(api.read()).toMatchObject({ elapsed: 0, frame: 0 });
  });

  it("gives the first frame after a resume a normal delta", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    api.pause();
    api.resume();
    tickFrame(ctx, 60_000);

    expect(api.read().delta).toBe(1000 / 60);
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

    expect(api.read()).toEqual({ delta: 1000, elapsed: 1000, scale: 1, frame: 1 });
  });

  it("ignores the fps cap", () => {
    const { api } = createApi();

    api.step(1);
    api.step(1);
    api.step(1);

    expect(api.read().frame).toBe(3);
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

    expect(api.read()).toMatchObject({ delta: 1000 / 60, frame: 1 });
  });

  it("uses the gap between two timestamps as the delta", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1020);

    expect(api.read()).toMatchObject({ delta: 20, frame: 2 });
  });

  it("clamps the delta at maxDeltaMs", () => {
    const { api, ctx } = createApi({ maxDeltaMs: 50 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 6000);

    expect(api.read().delta).toBe(50);
  });

  it("skips a frame that arrives before the fps cap allows it", () => {
    const { api, ctx } = createApi({ maxFps: 30 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1010);

    expect(api.read().frame).toBe(1);

    tickFrame(ctx, 1040);

    expect(api.read()).toMatchObject({ frame: 2, delta: 40 });
  });

  it("runs every frame of a 120 Hz source when the cap is 120", () => {
    const { api, ctx } = createApi({ maxFps: 120 });

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1008);
    tickFrame(ctx, 1016);

    expect(api.read()).toMatchObject({ frame: 3, delta: 8 });
  });

  it("halves a 120 Hz source under the default cap of 60", () => {
    const { api, ctx } = createApi();

    tickFrame(ctx, 1000);
    tickFrame(ctx, 1008);
    tickFrame(ctx, 1016);

    expect(api.read()).toMatchObject({ frame: 2, delta: 16 });
  });

  it("applies the scale to a real frame", () => {
    const { api, ctx } = createApi();

    api.setScale(2);
    tickFrame(ctx, 1000);
    tickFrame(ctx, 1020);

    expect(api.read()).toMatchObject({ delta: 40 });
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

    expect(api.read().frame).toBe(0);
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

    const time = api.read();
    // @ts-expect-error — the Time handed out by the api is readonly
    time.elapsed = 1;

    expect(api.read().elapsed).toBe(0);
  });

  it("returns an unsubscribe function from onFrame", () => {
    const { api } = createApi();

    expectTypeOf(api.onFrame).returns.toEqualTypeOf<() => void>();
    expectTypeOf(api.read).returns.toEqualTypeOf<Readonly<Time>>();

    expect(typeof api.onFrame("sync", () => {})).toBe("function");
  });
});
