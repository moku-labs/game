import { describe, expect, it } from "vitest";
import { loop, ramped } from "../features/bench/scenes/shared";

describe("the loops of the scenes", () => {
  // Bug: a loop that never turns: after one period every ramp stands at its end for the rest of the run.
  it("a loop starts over each period", () => {
    expect(loop(2500, 1000)).toBe(0.5);
    expect(loop(1000, 1000)).toBe(0);
  });

  // Bug: an alpha or a radius runs past 1 and the view blows out.
  it("a ramp stops at 1", () => {
    expect(ramped(0.25, 0.5)).toBe(0.5);
    expect(ramped(0.75, 0.5)).toBe(1);
  });
});
