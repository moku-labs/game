/**
 * @file time plugin — the six frame phases and the capture of their callback lists, shared by the
 * plain frame (`api.ts`) and the measured frame of an agent build (`measure.ts`).
 */
import type { CapturedPhases, Phase, TimeCtx } from "./types";

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
 * Captures the callback list of every phase at the start of a frame, in `PHASES` order. The lists
 * are copy-on-write (see `addFrameCallback`), so capturing the six references is enough: a
 * callback registered or removed during the frame changes the state's list, never the captured
 * one, and takes effect from the next frame on. No list is copied, the six references go into the
 * scratch array of the state, and no iterator is made, so a frame allocates nothing here.
 *
 * @param ctx - Domain context of the time plugin.
 * @returns The six callback lists, in call order.
 */
export function capturePhases(ctx: TimeCtx): Readonly<CapturedPhases> {
  const { callbacks, captured } = ctx.state;

  captured[0] = callbacks.input;
  captured[1] = callbacks.animate;
  captured[2] = callbacks.layout;
  captured[3] = callbacks.sync;
  captured[4] = callbacks.signals;
  captured[5] = callbacks.render;

  return captured;
}
