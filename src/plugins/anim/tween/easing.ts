/**
 * @file anim/tween — the named easing curves. Pure functions of the normalised time: no ctx, no
 * state, no allocation. Every named curve answers 0 at 0 and 1 at 1, so the last frame of a
 * track writes the exact target whatever curve it runs on.
 */
import type { Ease } from "../../world/types";

/** How far the two back curves overshoot. */
const BACK = 1.701_58;

/** The nine curves a step, a projection hook and a `defineMotion` transition may name. */
export const EASE_NAMES = [
  "linear",
  "in",
  "out",
  "inOut",
  "inCubic",
  "outCubic",
  "inOutCubic",
  "inBack",
  "outBack"
] as const;

/**
 * Eases a normalised time. A curve nobody knows is linear, and a function ease is called with
 * the same normalised time.
 *
 * @param ease - The curve to apply.
 * @param t - Normalised time between 0 and 1.
 * @returns The eased fraction. `inBack` dips below 0 and `outBack` rises above 1 in the middle.
 * @example
 * ```ts
 * applyEase("out", 0.5); // 0.75
 * applyEase("inCubic", 0.5); // 0.125
 * ```
 */
export function applyEase(ease: Ease, t: number): number {
  if (typeof ease === "function") return ease(t);

  switch (ease) {
    case "in": {
      return t * t;
    }
    case "out": {
      return 1 - (1 - t) * (1 - t);
    }
    case "inOut": {
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    }
    case "inCubic": {
      return t ** 3;
    }
    case "outCubic": {
      return 1 - (1 - t) ** 3;
    }
    case "inOutCubic": {
      return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    }
    case "inBack": {
      return (BACK + 1) * t ** 3 - BACK * t * t;
    }
    case "outBack": {
      return 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2;
    }
    default: {
      return t;
    }
  }
}
