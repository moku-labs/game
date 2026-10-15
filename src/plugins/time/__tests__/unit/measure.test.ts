import type { Log } from "@moku-labs/common/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTimeApi, tickFrame } from "../../api";
import { createTimeState } from "../../state";
import type { Api, Config, FrameMeasure, TimeCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the measured frame of an agent build (spec 11 T1, H2b.1). The flag is
// stubbed before the state is made, as the page defines it before the app.
// ---------------------------------------------------------------------------

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
  } as unknown as Log.LogApi;
}

function setup(overrides: Partial<Config> = {}): { api: Api; ctx: TimeCtx } {
  const config: Config = {
    maxFps: 60,
    maxDeltaMs: 50,
    idleFps: 30,
    idleAfterMs: 2000,
    adaptive: false,
    ...overrides
  };
  const ctx: TimeCtx = {
    global: {},
    config,
    state: createTimeState({ config }),
    emit: vi.fn(),
    log: createLogMock()
  };

  return { api: createTimeApi(ctx), ctx };
}

/** A page clock that answers the given readings in order, then keeps the last one. */
function scriptClock(readings: number[]): ReturnType<typeof vi.fn> {
  let index = 0;
  const now = vi.fn(() => {
    const value = readings[Math.min(index, readings.length - 1)] ?? 0;

    index += 1;

    return value;
  });

  vi.spyOn(globalThis.performance, "now").mockImplementation(now);

  return now;
}

/** Keeps a copy of every record a listener got, since the record is reused. */
function recorder(api: Api): FrameMeasure[] {
  const seen: FrameMeasure[] = [];

  api.measure(frame => seen.push({ ...frame, phaseMs: Float32Array.from(frame.phaseMs) }));

  return seen;
}

/** One frame of an agent build with a throwing input callback, with or without a measure listener. */
function runFailingFrame(measured: boolean): { order: string[]; errors: unknown[][] } {
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  const { api, ctx } = setup();
  const order: string[] = [];

  if (measured) api.measure(() => order.push("listener"));
  api.onFrame("render", () => order.push("render"));
  api.onFrame("input", () => {
    order.push("input");
    throw new Error("boom");
  });
  api.onFrame("input", () => order.push("input 2"));
  tickFrame(ctx, 16);

  return { order, errors: vi.mocked(ctx.log.error).mock.calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("time.measure in an agent build", () => {
  it("takes each phase's duration from the clock reads around it and the start delay from the timestamp", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const seen = recorder(api);

    scriptClock([10, 10.5, 11, 13.5, 14, 14.25, 16.75, 17]);
    tickFrame(ctx, 9);

    const frame = seen[0];

    expect(frame?.startMs).toBe(1);
    expect([...(frame?.phaseMs ?? [])]).toEqual([0.5, 0.5, 2.5, 0.5, 0.25, 2.5]);
    expect(frame?.workMs).toBe(7.75);
    expect(frame?.at).toBe(9);
    expect(frame?.frame).toBe(1);
  });

  it("measures the gap from the previous frame, none on the first and after a resume, and counts the ticks the cap skipped", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const seen = recorder(api);

    scriptClock([0]);
    tickFrame(ctx, 100);
    tickFrame(ctx, 105); // under the 60 fps cap: skipped
    tickFrame(ctx, 110); // skipped
    tickFrame(ctx, 117);
    tickFrame(ctx, 134);

    expect(seen.map(frame => frame.gapMs)).toEqual([Number.NaN, 17, 17]);
    expect(seen.map(frame => frame.skipped)).toEqual([0, 2, 0]);

    api.pause();
    tickFrame(ctx, 150); // paused: not a skipped tick
    api.resume();
    tickFrame(ctx, 900);

    expect(seen.at(-1)?.gapMs).toBeNaN();
    expect(seen.at(-1)?.skipped).toBe(0);
  });

  it("marks a frame of step() as stepped, with no start delay and no gap", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const seen = recorder(api);

    scriptClock([50]);
    tickFrame(ctx, 40);
    api.step(16);

    expect(seen[1]).toMatchObject({ stepped: true, startMs: 0, at: 50, capMs: 1000 / 60 });
    expect(seen[1]?.gapMs).toBeNaN();
  });

  it("runs the same callbacks in the same order with the same failure report as an unmeasured frame", () => {
    const plain = runFailingFrame(false);
    const measured = runFailingFrame(true);

    expect(measured.order).toEqual([...plain.order, "listener"]);
    expect(measured.errors).toEqual(plain.errors);
    expect(plain.errors[0]?.[0]).toBe("time: frame callback failed");
  });

  it("logs a throwing listener and still calls the next one", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const after = vi.fn();

    api.measure(() => {
      throw new Error("listener boom");
    });
    api.measure(after);
    tickFrame(ctx, 16);

    expect(after).toHaveBeenCalledTimes(1);
    expect(ctx.log.error).toHaveBeenCalledWith("time: measure listener failed", {
      error: new Error("listener boom")
    });
  });

  it("reports in each frame what the listeners took in the frame before", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const seen = recorder(api);

    // Frame 1: seven phase reads end at 6, the listener read at 6.75. Frame 2 starts at 20.
    scriptClock([0, 1, 2, 3, 4, 5, 6, 6.75, 20, 21, 22, 23, 24, 25, 26, 26.5]);
    tickFrame(ctx, 0);
    tickFrame(ctx, 17);

    expect(seen.map(frame => frame.listenersMs)).toEqual([0, 0.75]);
  });

  it("starts the gap over when the first listener comes after frames that were not measured", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const off = api.measure(() => undefined);

    scriptClock([0]);
    tickFrame(ctx, 0);
    off();
    off(); // the second call does nothing
    tickFrame(ctx, 17);
    const seen = recorder(api);

    tickFrame(ctx, 5000);

    expect(seen[0]?.gapMs).toBeNaN();
  });

  it("puts one frame of maxFps in rateMs and the idle cap in capMs", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup({ maxFps: 120, idleAfterMs: 0 });
    const seen = recorder(api);

    scriptClock([0]);
    tickFrame(ctx, 0); // goes idle in this frame
    tickFrame(ctx, 34);

    expect(seen[1]?.idle).toBe(true);
    expect(seen[1]?.capMs).toBeCloseTo(33.33, 2);
    expect(seen[1]?.rateMs).toBeCloseTo(8.33, 2);
  });

  it("charges the agent's spans to the running frame and hands them back at the end of a frame of the frame source", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    let inFrame = Number.NaN;

    api.onFrame("render", () => {
      api.chargeAgent(0.07);
      api.chargeAgent(0.07);
      api.chargeAgent(-1);
      api.chargeAgent(Number.NaN);
      inFrame = ctx.state.measure?.agentMs ?? Number.NaN;
    });
    tickFrame(ctx, 16);

    expect(inFrame).toBeCloseTo(0.14, 10);
    expect(ctx.state.measure?.agentMs).toBe(0);

    api.step(16);

    expect(ctx.state.measure?.agentMs).toBeCloseTo(0.14, 10);
  });

  it("answers the page clock from agentClock", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api } = setup();

    scriptClock([40_123.52]);

    expect(api.agentClock()?.()).toBe(40_123.52);
  });
});

describe("time.measure without the agent flag", () => {
  it("measures nothing, calls no listener, charges nothing and reads no clock", () => {
    const { api, ctx } = setup();
    const now = scriptClock([0]);
    const listener = vi.fn();
    const off = api.measure(listener);

    api.chargeAgent(1);
    tickFrame(ctx, 16);
    api.step(16);
    off();

    expect(listener).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(ctx.state.measure).toBeUndefined();
    expect(api.agentClock()).toBeUndefined();
  });

  it("reads no clock in an agent build while nobody listens", () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { api, ctx } = setup();
    const now = scriptClock([0]);

    tickFrame(ctx, 16);
    api.step(16);

    expect(now).not.toHaveBeenCalled();
  });

  it("measures nothing when the flag came after the app was made", () => {
    const { api, ctx } = setup();
    const listener = vi.fn();

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    api.measure(listener);
    api.chargeAgent(1);
    tickFrame(ctx, 16);

    expect(listener).not.toHaveBeenCalled();
  });
});
