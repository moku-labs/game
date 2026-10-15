/**
 * @file time plugin — the frame algorithm and the API factory.
 */
import { addMeasureListener, pageNow, runMeasuredFrame } from "./measure";
import { capturePhases, PHASES } from "./phases";
import { closeFrame, judgeFrame, observeTick, resumeRate, setRateChoice } from "./rate";
import { capSlackMs } from "./rate-rules";
import type { Api, FrameCallback, Phase, TimeCtx } from "./types";

export { PHASES } from "./phases";

/**
 * The unsubscribe `measure` answers in a build without the agent flag: it does nothing.
 */
const noMeasure = (): void => {};

/**
 * Message of the only throw of this plugin: `step` re-entered from inside a frame.
 */
const STEP_INSIDE_FRAME =
  "[game] time.step() called inside a frame.\n  Call it from outside a frame callback.";

/**
 * Calls every registered callback of every phase, in phase order and, inside a phase, in
 * registration order. A throwing callback is reported and never stops the others.
 *
 * @param ctx - Domain context of the time plugin.
 */
function runPhases(ctx: TimeCtx): void {
  const { time } = ctx.state;
  let index = 0;

  for (const callbacks of capturePhases(ctx)) {
    for (const callback of callbacks) {
      try {
        callback(time);
      } catch (error) {
        ctx.log.error("time: frame callback failed", { phase: PHASES[index], error });
      }
    }

    index += 1;
  }
}

/**
 * Runs the phases of one frame, measured in an agent build with a measure listener, plain otherwise, and answers its
 * work for the adaptive rate: from `at` to the clock read that ends the `render` phase, never after the measure
 * listeners. The plain path reads the clock once, and only for a frame of the frame source with a governor.
 *
 * @param ctx - Domain context of the time plugin.
 * @param at - The `requestAnimationFrame` timestamp; left out for a frame of `step()`.
 * @returns The work of the frame, ms; 0 when nobody reads it.
 */
function runFrameWork(ctx: TimeCtx, at: number | undefined): number {
  // Inline and positive, as the renderer's capture: Bun folds this guard under a production
  // `define` and drops the measured runner with it; `flow/doors/dev.ts` declares the global.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const { measure } = ctx.state;

    if (measure !== undefined && measure.listeners.length > 0) {
      runMeasuredFrame(ctx, measure, at ?? pageNow(), at === undefined);

      return measure.record.workMs;
    }
  }

  runPhases(ctx);

  return at !== undefined && ctx.state.rate.governor !== undefined ? pageNow() - at : 0;
}

/**
 * Runs exactly one frame: advances `Time` by the scaled delta, then calls the six phases.
 * The frame guard is open for the whole frame, so `step` cannot be re-entered from a callback.
 * In an agent build a frame with a measure listener runs measured. A frame from the frame source
 * then hands its drawn flag and its work to the adaptive rate, and in an agent build hands back
 * the agent's spans charged to it. Every frame forgets its drawn report, a stepped one too.
 *
 * @param ctx - Domain context of the time plugin.
 * @param unscaledDeltaMs - Delta of this frame in milliseconds, before the time scale.
 * @param at - The `requestAnimationFrame` timestamp; left out for a frame of `step()`.
 */
function runFrame(ctx: TimeCtx, unscaledDeltaMs: number, at?: number): void {
  const { time, rate } = ctx.state;

  time.delta = unscaledDeltaMs * time.scale;
  time.elapsed += time.delta;
  time.frame += 1;

  ctx.state.stepping = true;
  try {
    const workMs = runFrameWork(ctx, at);
    const { governor } = rate;

    // After the phases: `closeFrame` reads the agent's spans before they are zeroed.
    if (at !== undefined && governor !== undefined) closeFrame(ctx, governor, workMs);

    if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
      const { measure } = ctx.state;

      if (measure !== undefined && at !== undefined) measure.agentMs = 0;
    }
  } finally {
    ctx.state.stepping = false;
    rate.drawnNow = false;
    rate.probedNow = false;
  }
}

/**
 * Resets the idle timer and lifts the idle cap at once, so the next frame runs at `maxFps`, and
 * counts the wake for the renderer. Four assignments: safe to call from inside a frame, and safe
 * to call on every pointer sample.
 *
 * @param ctx - Domain context of the time plugin.
 */
function wakeClock(ctx: TimeCtx): void {
  ctx.state.wakes += 1;
  ctx.state.lastWakeMs = ctx.state.unscaledElapsedMs;
  ctx.state.idle = false;
  ctx.state.time.idle = false;
}

/**
 * Advances the unscaled clock of the idle timer by one frame of the frame source and decides
 * whether the loop is idle: it is, when the idle cap is on and no wake arrived for `idleAfterMs`
 * of unscaled time. The clock is unscaled on purpose, so `setScale(0)` does not stop the idle
 * detection. `step` never touches it: a test drives its own frames and is never capped.
 *
 * @param ctx - Domain context of the time plugin.
 * @param gapMs - The frame's raw gap in milliseconds, before the time scale, not clamped at `maxDeltaMs`.
 */
function updateIdle(ctx: TimeCtx, gapMs: number): void {
  const { idleFps, idleAfterMs } = ctx.config;

  ctx.state.unscaledElapsedMs += gapMs;
  ctx.state.idle = idleFps > 0 && ctx.state.unscaledElapsedMs - ctx.state.lastWakeMs >= idleAfterMs;
  ctx.state.time.idle = ctx.state.idle;
}

/**
 * Counts a tick the cap skipped, for the measure record of an agent build.
 *
 * @param ctx - Domain context of the time plugin.
 */
function countSkipped(ctx: TimeCtx): void {
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const { measure } = ctx.state;

    if (measure !== undefined) measure.skipped += 1;
  }
}

/**
 * Notes the cap that let a frame through, for the measure record of an agent build, before the
 * idle timer moves on.
 *
 * @param ctx - Domain context of the time plugin.
 * @param frameMs - One frame of the cap.
 */
function noteCap(ctx: TimeCtx, frameMs: number): void {
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const { measure } = ctx.state;

    if (measure !== undefined) {
      measure.record.capMs = frameMs;
      measure.record.idle = ctx.state.idle;
    }
  }
}

/**
 * Runs one frame of the real frame source. A paused clock runs no phase. Every tick, run or
 * skipped, is a sample of the display rate. The first frame, and the first frame after a
 * `resume`, counts as one capped frame instead of the gap to a stale timestamp. A frame that
 * arrives more than the cap's slack before the current cap allows it is skipped — the cap is
 * `idleFps` while the screen is idle and the loop's rate (`rate().fps`) otherwise, the slack half
 * a display period (`capSlackMs`) — and a long gap is clamped at `maxDeltaMs` so a backgrounded
 * tab does not produce a giant step. The idle timer moves by the raw gap, at most `idleAfterMs`,
 * so a throttled page goes idle in `idleAfterMs`. The interval that ends at a run frame is judged
 * by the adaptive rate. An agent build counts the skipped ticks and notes the cap the frame ran
 * under for its measure record.
 *
 * @param ctx - Domain context of the time plugin.
 * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
 */
export function tickFrame(ctx: TimeCtx, timestamp: number): void {
  if (ctx.state.paused) return;

  const { rate } = ctx.state;
  const { governor } = rate;

  observeTick(ctx, timestamp);

  // `Math.min`: the idle cap never raises a rate below `idleFps`.
  const frameMs = 1000 / (ctx.state.idle ? Math.min(ctx.config.idleFps, rate.fps) : rate.fps);
  const { lastTimestamp } = ctx.state;
  const rawDeltaMs = lastTimestamp === undefined ? frameMs : timestamp - lastTimestamp;

  // The slack: vsync jitter (15.6–17.8 ms at 60 Hz) must not drop a frame of a 60 cap.
  if (rawDeltaMs < frameMs - capSlackMs(rate.display.hz, frameMs)) {
    countSkipped(ctx);

    return;
  }

  // The interval that ends here belongs to the frame that ran last.
  if (governor !== undefined && lastTimestamp !== undefined) {
    judgeFrame(ctx, governor, rawDeltaMs, timestamp);
  }

  noteCap(ctx, frameMs);
  ctx.state.lastTimestamp = timestamp;

  const unscaledDeltaMs = Math.min(rawDeltaMs, ctx.config.maxDeltaMs);

  // The raw gap, not the clamped delta: a page throttled to 1 Hz goes idle in `idleAfterMs`.
  updateIdle(ctx, Math.min(rawDeltaMs, ctx.config.idleAfterMs));
  runFrame(ctx, unscaledDeltaMs, timestamp);
}

/**
 * Adds a callback to the end of its phase list and returns the matching unsubscribe.
 *
 * @param ctx - Domain context of the time plugin.
 * @param phase - Phase the callback belongs to.
 * @param callback - Function called once per frame with the current `Time`.
 * @returns Unsubscribe function; calling it twice is a no-op.
 */
function addFrameCallback(ctx: TimeCtx, phase: Phase, callback: FrameCallback): () => void {
  // Copy-on-write: a running frame keeps the list it captured; see `capturePhases`.
  ctx.state.callbacks[phase] = [...ctx.state.callbacks[phase], callback];
  let registered = true;

  return () => {
    if (!registered) return;
    registered = false;

    const callbacks = ctx.state.callbacks[phase];
    ctx.state.callbacks[phase] = callbacks.toSpliced(callbacks.lastIndexOf(callback), 1);
  };
}

/**
 * Creates the time API: frame callbacks per phase, the `Time` resource, scale, pause and
 * resume, `wake` for the idle cap, the measurement of an agent build, the frame rate, and `step`
 * for tests and tools.
 *
 * @param ctx - Domain context of the time plugin.
 * @returns The public API of the time plugin.
 */
export function createTimeApi(ctx: TimeCtx): Api {
  return {
    onFrame: (phase, callback) => addFrameCallback(ctx, phase, callback),

    snapshot: () => ({ ...ctx.state.time }),

    setScale: scale => {
      ctx.state.time.scale = Math.max(0, scale);
    },

    pause: () => {
      ctx.state.paused = true;
    },

    resume: () => {
      ctx.state.paused = false;
      ctx.state.lastTimestamp = undefined;
      // A resume is a wake: the screen comes back, so it comes back at the full frame rate.
      wakeClock(ctx);
      resumeRate(ctx.state.rate);

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        const { measure } = ctx.state;

        // The first frame after the pause has no gap to report, and no tick was skipped.
        if (measure !== undefined) {
          measure.lastAt = Number.NaN;
          measure.skipped = 0;
        }
      }
    },

    isPaused: () => ctx.state.paused,

    isRunning: () => ctx.state.running,

    wake: () => wakeClock(ctx),

    wakes: () => ctx.state.wakes,

    measure: listener => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        const { measure } = ctx.state;

        if (measure !== undefined) return addMeasureListener(measure, listener);
      }

      return noMeasure;
    },

    agentClock: () =>
      typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ ? pageNow : undefined,

    chargeAgent: ms => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
        const { measure } = ctx.state;

        if (measure !== undefined && Number.isFinite(ms) && ms > 0) measure.agentMs += ms;
      }
    },

    rate: () => ctx.state.rate.snapshot,

    setRate: choice => setRateChoice(ctx, choice),

    frameDrawn: () => {
      ctx.state.rate.drawnNow = true;
    },

    frameProbed: () => {
      ctx.state.rate.probedNow = true;
    },

    step: deltaMs => {
      if (ctx.state.stepping) throw new Error(STEP_INSIDE_FRAME);

      runFrame(ctx, deltaMs);
    }
  };
}
