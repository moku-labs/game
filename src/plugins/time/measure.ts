/**
 * @file time — the measured frame of an agent build and the page clock it reads. `time` is outside lint L3, so it may
 * read `performance.now()`: the clock measures the page, never the game, whose time is `Time`. Nothing here runs
 * without the agent flag: `runFrame` reaches it only inside the agent branch.
 */
import { capturePhases, PHASES } from "./phases";
import type { FrameCallback, FrameMeasure, MeasureListener, MeasureState, TimeCtx } from "./types";

/** Length of `FrameMeasure.phaseMs`: one duration per phase. */
const PHASE_COUNT = 6;

/**
 * Creates the measure state of an agent build: one reused record, `lastAt` NaN, no listener.
 *
 * @returns The measure branch of the time state.
 */
export function createMeasureState(): MeasureState {
  const record: FrameMeasure = {
    frame: 0,
    at: 0,
    gapMs: Number.NaN,
    capMs: 0,
    rateMs: 0,
    skipped: 0,
    startMs: 0,
    phaseMs: new Float32Array(PHASE_COUNT),
    workMs: 0,
    listenersMs: 0,
    idle: false,
    stepped: false
  };

  return { listeners: [], record, lastAt: Number.NaN, skipped: 0, listenersMs: 0, agentMs: 0 };
}

/**
 * Reads the page clock: `globalThis.performance.now()` at call time, milliseconds on the page's timeline. Read at call
 * time, so a test stubs it.
 *
 * @returns The page clock, ms.
 */
export function pageNow(): number {
  return globalThis.performance.now();
}

/**
 * Runs the callbacks of one phase as `runPhases` does, same order, same error report, then writes how long the phase
 * took into the record. An indexed loop: the measured frame makes no iterator.
 *
 * @param ctx - Domain context of the time plugin.
 * @param record - The reused record of the frame.
 * @param callbacks - The callbacks of the phase, as captured at the start of the frame.
 * @param phase - Index of the phase in `PHASES`.
 * @param start - Page clock at the start of the phase.
 * @returns Page clock at the end of the phase.
 */
function timePhase(
  ctx: TimeCtx,
  record: FrameMeasure,
  callbacks: readonly FrameCallback[],
  phase: number,
  start: number
): number {
  const { time } = ctx.state;
  const count = callbacks.length;

  for (let index = 0; index < count; index += 1) {
    try {
      callbacks[index]?.(time);
    } catch (error) {
      ctx.log.error("time: frame callback failed", { phase: PHASES[phase], error });
    }
  }

  const end = pageNow();

  record.phaseMs[phase] = end - start;

  return end;
}

/**
 * Runs one frame's phases while reading the page clock around each phase (seven reads), fills the reused record and
 * hands it to every measure listener, each in its own `try`, then reads the clock once more for what the listeners
 * took. Frames from the frame source come with `capMs` and `idle` already written by `tickFrame`.
 *
 * @param ctx - Domain context of the time plugin.
 * @param measure - The measure state of the agent build.
 * @param at - Start of the frame on the page clock.
 * @param stepped - The frame came from `step()`.
 */
export function runMeasuredFrame(
  ctx: TimeCtx,
  measure: MeasureState,
  at: number,
  stepped: boolean
): void {
  const { record } = measure;
  const phases = capturePhases(ctx);
  let mark = pageNow();

  record.startMs = stepped ? 0 : mark - at;
  mark = timePhase(ctx, record, phases[0], 0, mark);
  mark = timePhase(ctx, record, phases[1], 1, mark);
  mark = timePhase(ctx, record, phases[2], 2, mark);
  mark = timePhase(ctx, record, phases[3], 3, mark);
  mark = timePhase(ctx, record, phases[4], 4, mark);
  mark = timePhase(ctx, record, phases[5], 5, mark);

  record.frame = ctx.state.time.frame;
  record.at = at;
  // NaN − lastAt stays NaN: the first frame and the first after a resume have no gap.
  record.gapMs = stepped ? Number.NaN : at - measure.lastAt;
  record.rateMs = 1000 / ctx.state.rate.fps;
  record.skipped = measure.skipped;
  record.workMs = mark - at;
  record.listenersMs = measure.listenersMs;
  record.stepped = stepped;

  if (stepped) {
    record.idle = ctx.state.idle;
    const { fps } = ctx.state.rate;

    record.capMs = 1000 / (ctx.state.idle ? Math.min(ctx.config.idleFps, fps) : fps);
  }

  // Copy-on-write, as the callbacks: a listener added now is called from the next frame on.
  const { listeners } = measure;
  const count = listeners.length;

  for (let index = 0; index < count; index += 1) {
    try {
      listeners[index]?.(record);
    } catch (error) {
      ctx.log.error("time: measure listener failed", { error });
    }
  }

  measure.listenersMs = pageNow() - mark;
  measure.lastAt = at;
  measure.skipped = 0;
}

/**
 * Adds a measure listener, copy-on-write, and returns its unsubscribe. The first listener starts the gap over: a
 * frame measured long after the last one has no gap to report.
 *
 * @param measure - The measure state of the agent build.
 * @param listener - Called after the `render` phase of every frame.
 * @returns The unsubscribe; calling it twice is a no-op.
 */
export function addMeasureListener(measure: MeasureState, listener: MeasureListener): () => void {
  if (measure.listeners.length === 0) {
    measure.lastAt = Number.NaN;
    measure.skipped = 0;
  }

  measure.listeners = [...measure.listeners, listener];
  let registered = true;

  return () => {
    if (!registered) return;
    registered = false;

    const { listeners } = measure;

    measure.listeners = listeners.toSpliced(listeners.lastIndexOf(listener), 1);
  };
}
