import { describe, expect, it } from "vitest";
import { cubicBezier } from "../../tween/bezier";

// ---------------------------------------------------------------------------
// Unit test: the CSS timing function `cubic-bezier(x1, y1, x2, y2)` read off a table built once.
// The reference below solves the curve the slow, sure way, by halving, at every time asked.
// ---------------------------------------------------------------------------

/**
 * One coordinate of the curve from 0 to 1 with the inner control values `first` and `second`.
 *
 * @param along - The curve parameter.
 * @param first - The first control value.
 * @param second - The second control value.
 * @returns The coordinate.
 */
function coordinate(along: number, first: number, second: number): number {
  const back = 1 - along;

  return 3 * back * back * along * first + 3 * back * along * along * second + along ** 3;
}

/**
 * The analytic curve: the parameter whose x is `time`, found by 60 halvings, and its y.
 *
 * @param points - The control points `[x1, y1, x2, y2]`.
 * @param time - The time, 0 to 1.
 * @returns The progress at `time`.
 */
function reference(points: readonly number[], time: number): number {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  let low = 0;
  let high = 1;

  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;

    if (coordinate(middle, x1, x2) < time) low = middle;
    else high = middle;
  }

  return coordinate((low + high) / 2, y1, y2);
}

/**
 * The largest distance of the factory's curve from the analytic one over 20 001 times.
 *
 * @param points - The control points `[x1, y1, x2, y2]`.
 * @returns The largest absolute difference.
 */
function worstError(points: readonly [number, number, number, number]): number {
  const ease = cubicBezier(...points);
  let worst = 0;

  for (let index = 0; index <= 20_000; index++) {
    const time = index / 20_000;

    worst = Math.max(worst, Math.abs(ease(time) - reference(points, time)));
  }

  return worst;
}

/** The design's curves of A Memory Missing, which come to the engine first. */
const DESIGN = {
  out: [0.22, 0.61, 0.36, 1],
  in: [0.55, 0.06, 0.68, 0.19],
  inOut: [0.65, 0, 0.35, 1],
  outBack: [0.34, 1.56, 0.64, 1],
  spring: [0.3, 1.8, 0.5, 1],
  hopUp: [0.2, 0.7, 0.4, 1],
  hopDown: [0.6, 0, 0.85, 0.4]
} as const;

/** The CSS keywords, an anticipation below 0 and above 1, and curves that leave vertically. */
const OTHERS = {
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  anticipate: [0.68, -0.6, 0.32, 1.6],
  outCirc: [0, 0.55, 0.45, 1],
  inCirc: [0.55, 0, 1, 0.45],
  steepest: [0, 1, 0, 1],
  verticalMiddle: [1, 0, 0, 1]
} as const;

describe("anim/tween cubicBezier", () => {
  it("follows every curve of the design within 1e-4 of the analytic curve", () => {
    for (const points of Object.values(DESIGN)) expect(worstError(points)).toBeLessThan(1e-4);
  });

  it("follows the CSS keywords, an overshoot both ways and vertical tangents within 1e-4", () => {
    for (const points of Object.values(OTHERS)) expect(worstError(points)).toBeLessThan(1e-4);
  });

  it("is exactly 0 at and before the start and exactly 1 at and after the end", () => {
    const out = cubicBezier(0.22, 0.61, 0.36, 1);

    expect(out(0)).toBe(0);
    expect(out(-0.5)).toBe(0);
    expect(out(1)).toBe(1);
    expect(out(2)).toBe(1);
  });

  it("refuses an x outside 0 to 1, which would make the curve no function of time", () => {
    expect(() => cubicBezier(-0.1, 0, 0.5, 1)).toThrow(/x1 and x2 between 0 and 1/);
    expect(() => cubicBezier(0.5, 0, 1.2, 1)).toThrow(/x1 and x2 between 0 and 1/);
    expect(() => cubicBezier(Number.NaN, 0, 0.5, 1)).toThrow(/x1 and x2 between 0 and 1/);
  });
});
