/**
 * @file time plugin — the frame algorithm and the API factory.
 */
import { addMeasureListener, pageNow, runMeasuredFrame } from "./measure";
import { capturePhases, PHASES } from "./phases";
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
 * Runs exactly one frame: advances `Time` by the scaled delta, then calls the six phases.
 * The frame guard is open for the whole frame, so `step` cannot be re-entered from a callback.
 * In an agent build a frame with a measure listener runs measured; a frame from the frame source
 * hands back the agent's spans charged to it once its phases and listeners ran.
 *
 * @param ctx - Domain context of the time plugin.
 * @param unscaledDeltaMs - Delta of this frame in milliseconds, before the time scale.
 * @param at - The `requestAnimationFrame` timestamp; left out for a frame of `step()`.
 */
function runFrame(ctx: TimeCtx, unscaledDeltaMs: number, at?: number): void {
  const { time } = ctx.state;

  time.delta = unscaledDeltaMs * time.scale;
  time.elapsed += time.delta;
  time.frame += 1;

  ctx.state.stepping = true;
  try {
    // Inline and positive, as the renderer's capture: Bun folds this guard under a production
    // `define` and drops the measured runner with it; `flow/doors/dev.ts` declares the global.
    if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
      const { measure } = ctx.state;

      if (measure !== undefined && measure.listeners.length > 0) {
        runMeasuredFrame(ctx, measure, at ?? pageNow(), at === undefined);
      } else {
        runPhases(ctx);
      }

      if (measure !== undefined && at !== undefined) measure.agentMs = 0;
    } else {
      runPhases(ctx);
    }
  } finally {
    ctx.state.stepping = false;
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
 * @param unscaledDeltaMs - Delta of this frame in milliseconds, before the time scale.
 */
function updateIdle(ctx: TimeCtx, unscaledDeltaMs: number): void {
  const { idleFps, idleAfterMs } = ctx.config;

  ctx.state.unscaledElapsedMs += unscaledDeltaMs;
  ctx.state.idle = idleFps > 0 && ctx.state.unscaledElapsedMs - ctx.state.lastWakeMs >= idleAfterMs;
  ctx.state.time.idle = ctx.state.idle;
}

/**
 * Runs one frame of the real frame source. A paused clock runs no phase. The first frame, and
 * the first frame after a `resume`, counts as one capped frame instead of the gap to a stale
 * timestamp. A frame that arrives before the current cap allows it is skipped — the cap is
 * `idleFps` while the screen is idle and `maxFps` otherwise — and a long gap is clamped at
 * `maxDeltaMs` so a backgrounded tab does not produce a giant step. An agent build counts the
 * skipped ticks and notes the cap the frame ran under for its measure record.
 *
 * @param ctx - Domain context of the time plugin.
 * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
 */
export function tickFrame(ctx: TimeCtx, timestamp: number): void {
  if (ctx.state.paused) return;

  const frameMs = 1000 / (ctx.state.idle ? ctx.config.idleFps : ctx.config.maxFps);
  const { lastTimestamp } = ctx.state;
  const rawDeltaMs = lastTimestamp === undefined ? frameMs : timestamp - lastTimestamp;

  // One millisecond of tolerance: a frame source rarely hits the cap exactly.
  if (rawDeltaMs < frameMs - 1) {
    if (
      typeof __MOKU_GAME_AGENT__ !== "undefined" &&
      __MOKU_GAME_AGENT__ &&
      ctx.state.measure !== undefined
    ) {
      ctx.state.measure.skipped += 1;
    }

    return;
  }

  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    const { measure } = ctx.state;

    if (measure !== undefined) {
      // The cap that let this frame through, before the idle timer moves on below.
      measure.record.capMs = frameMs;
      measure.record.idle = ctx.state.idle;
    }
  }

  ctx.state.lastTimestamp = timestamp;

  const unscaledDeltaMs = Math.min(rawDeltaMs, ctx.config.maxDeltaMs);

  updateIdle(ctx, unscaledDeltaMs);
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
 * resume, `wake` for the idle cap, the measurement of an agent build, and `step` for tests and
 * tools.
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

    step: deltaMs => {
      if (ctx.state.stepping) throw new Error(STEP_INSIDE_FRAME);

      runFrame(ctx, deltaMs);
    }
  };
}
