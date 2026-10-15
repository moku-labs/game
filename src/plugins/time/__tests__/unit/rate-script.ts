/**
 * @file time — the scripted frame source of the adaptive frame rate tests (spec 21, "Testing Strategy"). Not a test
 * file: the projects collect `*.test.ts` only. A script owns one time context with `adaptive` set, a page clock that
 * `performance.now()` answers, and a `render` callback that stands for the renderer: it spends the frame's work on
 * the clock and reports the frame drawn. Its ticks are the display's vsyncs, the ticks the cap skips included.
 */
import type { Log } from "@moku-labs/common/browser";
import { type Mock, vi } from "vitest";
import { createTimeApi, tickFrame } from "../../api";
import { startTime, stopTime } from "../../lifecycle";
import { createTimeState } from "../../state";
import type { Api, Config, Governor, RateChange, TimeCtx } from "../../types";

/** What the frames of a stretch do. Left out: 1 ms of work, drawn, no probe, no agent charge. */
export type FrameScript = {
  /** Work of the frame on the page clock, ms. */
  workMs?: number;
  /** The renderer drew the frame. */
  drawn?: boolean;
  /** The frame also drew warm-up probes. */
  probed?: boolean;
  /** An agent span charged to the frame, ms. */
  charge?: number;
};

/** One scripted frame source over one time context. */
export type Script = {
  readonly ctx: TimeCtx;
  readonly api: Api;
  readonly emit: Mock;
  readonly log: Log.LogApi;
  /** The governor of the context; throws without `adaptive`. */
  governor(): Governor;
  /** Timestamp of the last tick, run or skipped. */
  last(): number;
  /** Moves the page clock on, as work outside a frame would. */
  advance(ms: number): void;
  /** How often `performance.now()` was read. */
  clockReads(): number;
  /** The display the next ticks of `play` come from. */
  setDisplay(hz: number): void;
  /** One run frame at `at`, with the vsync ticks the cap skips since the last tick. */
  tickAt(at: number, frame?: FrameScript): void;
  /** One run frame `gapMs` after the last run frame. */
  gap(gapMs: number, frame?: FrameScript): void;
  /** `count` run frames, each `gapMs` after the one before. */
  gaps(gapMs: number, count: number, frame?: FrameScript): void;
  /** The device: every vsync of the display for `ms`, but none while the last frame's work still runs. */
  play(ms: number, frame?: FrameScript): void;
  /** Runs frames `gapMs` apart until the rate is `fps`; answers the timestamp of the tick that switched it. */
  untilRate(fps: number, gapMs: number, frame?: FrameScript): number;
  /** `onStart` of the plugin: the loop (none in Bun), the native shell and the thermal listener. */
  start(): void;
  /** `onStop` of the plugin. */
  stop(): void;
  /** Every `time:rate` payload so far, in order. */
  changes(): RateChange[];
};

/** A frame the script does not describe: light, drawn. */
const LIGHT: FrameScript = {};

/**
 * The page clock `performance.now()` answers, one for every script of a test: each tick sets it to its timestamp
 * first, so two scripts of one test never read each other's time.
 */
const pageClock = { now: 1000 };

/**
 * Creates a scripted time context: `maxFps: 120`, `adaptive: { floor: 60 }`, no idle cap unless the config says so,
 * a 120 Hz display, the page clock at 1000.
 *
 * @param options - The config overrides and the display rate.
 * @param options.config - Overrides of the time config.
 * @param options.displayHz - The display's refresh rate; 120 when left out.
 * @returns The script.
 */
export function createScript(
  options: { config?: Partial<Config>; displayHz?: number } = {}
): Script {
  const config: Config = {
    maxFps: 120,
    maxDeltaMs: 50,
    idleFps: 0,
    idleAfterMs: 2000,
    adaptive: { floor: 60 },
    ...options.config
  };
  const emit = vi.fn();
  // Partial mock of a complex external type: the four levels the plugin writes.
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  } as unknown as Log.LogApi;
  const ctx: TimeCtx = { global: {}, config, state: createTimeState({ config }), emit, log };
  const api = createTimeApi(ctx);
  const clock = pageClock;
  const reads = vi.spyOn(globalThis.performance, "now").mockImplementation(() => pageClock.now);
  const source = { period: 1000 / (options.displayHz ?? 120), lastTick: 1000, lastRun: 1000 };
  let busyUntil = 0;
  let current = LIGHT;

  api.onFrame("render", () => {
    clock.now += current.workMs ?? 1;
    if (current.charge !== undefined) api.chargeAgent(current.charge);
    if (current.drawn ?? true) api.frameDrawn();
    if (current.probed === true) api.frameProbed();
  });

  /**
   * One tick of the frame source.
   *
   * @param at - Its timestamp.
   * @param frame - What the frame does when it runs.
   */
  const tick = (at: number, frame: FrameScript): void => {
    const before = ctx.state.time.frame;

    current = frame;
    clock.now = at;
    tickFrame(ctx, at);
    source.lastTick = at;

    if (ctx.state.time.frame !== before) {
      source.lastRun = at;
      busyUntil = at + (frame.workMs ?? 1);
    }
  };

  const script: Script = {
    ctx,
    api,
    emit,
    log,
    governor: () => {
      const { governor } = ctx.state.rate;

      if (governor === undefined) throw new Error("rate-script: no governor without adaptive");

      return governor;
    },
    last: () => source.lastTick,
    advance: ms => {
      clock.now += ms;
    },
    clockReads: () => reads.mock.calls.length,
    setDisplay: hz => {
      source.period = 1000 / hz;
    },
    tickAt: (at, frame = LIGHT) => {
      const capMs = 1000 / ctx.state.rate.fps;

      // The vsyncs between: the cap skips them, the display detection sees them.
      for (
        let skipped = source.lastTick + source.period;
        skipped < at - 0.5 && skipped - source.lastRun < capMs - 1;
        skipped += source.period
      ) {
        tick(skipped, frame);
      }

      tick(at, frame);
    },
    gap: (gapMs, frame = LIGHT) => script.tickAt(source.lastRun + gapMs, frame),
    gaps: (gapMs, count, frame = LIGHT) => {
      for (let index = 0; index < count; index += 1) script.gap(gapMs, frame);
    },
    play: (ms, frame = LIGHT) => {
      const end = source.lastTick + ms;

      for (;;) {
        let at = source.lastTick + source.period;

        while (at < busyUntil) at += source.period;
        if (at > end + 1e-6) return;

        tick(at, frame);
      }
    },
    untilRate: (fps, gapMs, frame = LIGHT) => {
      for (let index = 0; index < 10_000; index += 1) {
        script.gap(gapMs, frame);

        if (ctx.state.rate.fps === fps) return source.lastRun;
      }

      throw new Error(`rate-script: the rate never reached ${String(fps)}`);
    },
    start: () => startTime(ctx),
    stop: () => stopTime(ctx.state),
    changes: () =>
      emit.mock.calls
        .filter(([name]) => name === "time:rate")
        .map(([, payload]) => payload as RateChange)
  };

  return script;
}
