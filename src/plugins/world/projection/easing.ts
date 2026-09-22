/**
 * @file world/projection — the four built-in easings of the minimal tween.
 */
import type { Ease } from "./types";

/**
 * Eases a normalised time. A function ease is called as it is; the four names are the usual
 * quadratic curves.
 *
 * @param ease - The easing to apply.
 * @param t - Normalised time between 0 and 1.
 * @returns The eased fraction.
 * @example
 * ```ts
 * applyEase("linear", 0.25); // 0.25
 * applyEase("in", 0.5); // 0.25
 * ```
 */
export function applyEase(ease: Ease, t: number): number {
  if (typeof ease === "function") return ease(t);
  if (ease === "in") return t * t;
  if (ease === "out") return 1 - (1 - t) * (1 - t);
  if (ease === "inOut") return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  return t;
}
