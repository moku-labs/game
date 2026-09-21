/**
 * @file time plugin — the frame algorithm and the API factory.
 */
import type { Api, FrameCallback, Phase, TimeCtx } from "./types";

/**
 * The six frame phases, in the exact order they run every frame.
 *
 * @example
 * ```ts
 * PHASES.indexOf("sync"); // 3
 * ```
 */
export const PHASES: readonly Phase[] = ["input", "animate", "layout", "sync", "signals", "render"];

/**
 * Message of the only throw of this plugin: `step` re-entered from inside a frame.
 */
const STEP_INSIDE_FRAME =
  "[game] time.step() called inside a frame.\n  Call it from outside a frame callback.";

/**
 * Captures the callback list of every phase at the start of a frame, in phase order. The lists are
 * copy-on-write (see `addFrameCallback`), so capturing the six references is enough: a callback
 * registered or removed during the frame changes the state's list, never the captured one, and
 * takes effect from the next frame on. No list is copied in the frame loop, and the six
 * references go into the scratch array of the state, so a frame allocates nothing here.
 *
 * @param ctx - Domain context of the time plugin.
 * @returns The six callback lists, in call order.
 */
function capturePhases(ctx: TimeCtx): readonly (readonly FrameCallback[])[] {
  const { captured } = ctx.state;
  let index = 0;

  for (const phase of PHASES) {
    captured[index] = ctx.state.callbacks[phase];
    index += 1;
  }

  return captured;
}

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
 *
 * @param ctx - Domain context of the time plugin.
 * @param unscaledDeltaMs - Delta of this frame in milliseconds, before the time scale.
 */
function runFrame(ctx: TimeCtx, unscaledDeltaMs: number): void {
  const { time } = ctx.state;

  time.delta = unscaledDeltaMs * time.scale;
  time.elapsed += time.delta;
  time.frame += 1;

  ctx.state.stepping = true;
  try {
    runPhases(ctx);
  } finally {
    ctx.state.stepping = false;
  }
}

/**
 * Runs one frame of the real frame source. A paused clock runs no phase. The first frame, and
 * the first frame after a `resume`, counts as one capped frame instead of the gap to a stale
 * timestamp. A frame that arrives before the fps cap allows it is skipped, and a long gap is
 * clamped at `maxDeltaMs` so a backgrounded tab does not produce a giant step.
 *
 * @param ctx - Domain context of the time plugin.
 * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
 */
export function tickFrame(ctx: TimeCtx, timestamp: number): void {
  if (ctx.state.paused) return;

  const frameMs = 1000 / ctx.config.maxFps;
  const { lastTimestamp } = ctx.state;
  const rawDeltaMs = lastTimestamp === undefined ? frameMs : timestamp - lastTimestamp;

  // One millisecond of tolerance: a frame source rarely hits the cap exactly.
  if (rawDeltaMs < frameMs - 1) return;

  ctx.state.lastTimestamp = timestamp;
  runFrame(ctx, Math.min(rawDeltaMs, ctx.config.maxDeltaMs));
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
 * resume, and `step` for tests and tools.
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
    },

    isPaused: () => ctx.state.paused,

    isRunning: () => ctx.state.running,

    step: deltaMs => {
      if (ctx.state.stepping) throw new Error(STEP_INSIDE_FRAME);

      runFrame(ctx, deltaMs);
    }
  };
}
