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
 * Eases the normalised time in one cell of a `Float64Array`, in place: `applyEase` for the frame
 * step. It takes no number and returns none, so a frame boxes no number whether V8 inlines it or
 * not. A curve nobody knows is linear, and a function ease is called with the same time.
 *
 * @param ease - The curve to apply.
 * @param cells - The cells; `cells[at]` holds the normalised time and receives the eased fraction.
 * @param at - The index of the cell.
 * @example
 * ```ts
 * const cells = Float64Array.of(0.5);
 * easeCell("out", cells, 0); // cells[0] === 0.75
 * ```
 */
export function easeCell(ease: Ease, cells: Float64Array, at: number): void {
  const t = cells[at] ?? 0;

  if (typeof ease === "function") {
    cells[at] = ease(t);

    return;
  }

  switch (ease) {
    case "in": {
      cells[at] = t * t;
      break;
    }
    case "out": {
      cells[at] = 1 - (1 - t) * (1 - t);
      break;
    }
    case "inOut": {
      cells[at] = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      break;
    }
    case "inCubic": {
      cells[at] = t ** 3;
      break;
    }
    case "outCubic": {
      cells[at] = 1 - (1 - t) ** 3;
      break;
    }
    case "inOutCubic": {
      cells[at] = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      break;
    }
    case "inBack": {
      cells[at] = (BACK + 1) * t ** 3 - BACK * t * t;
      break;
    }
    case "outBack": {
      cells[at] = 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2;
      break;
    }
    default: {
      break;
    }
  }
}

/** The cell `applyEase` eases in. */
const EASED = new Float64Array(1);

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
  EASED[0] = t;
  easeCell(ease, EASED, 0);

  return EASED[0] ?? 0;
}
