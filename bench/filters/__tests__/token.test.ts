import { describe, expect, it } from "vitest";
import { parseToken } from "../lib/token";

describe("the #scene token", () => {
  // Bug: the first word is lost, and every address opens the default scene.
  it("reads the scene and its numbers", () => {
    expect(parseToken("#slope-4-mask&k=12&n=3")).toEqual({
      scene: "slope-4-mask",
      k: 12,
      n: 3,
      arms: [],
      every: 2
    });
  });

  // Bug: a bare address shows nothing.
  it("opens the ballast with no token", () => {
    expect(parseToken("")).toEqual({ scene: "ballast", arms: [], every: 2 });
    expect(parseToken("#")).toEqual({ scene: "ballast", arms: [], every: 2 });
  });

  // Bug: k=abc reaches a spawn loop as NaN, and k=-1 spawns nothing without a word.
  it("drops a number that is not a whole one at 0 or above", () => {
    expect(parseToken("#full&k=abc&n=-1")).toEqual({ scene: "full", arms: [], every: 2 });
    expect(parseToken("#full&k=0").k).toBe(0);
    expect(parseToken("#full&every=0").every).toBe(2);
  });

  // Bug: a compare of pixels runs on a moving value: the mode and live are never at one number.
  it("reads a held time, and drops one that is no whole number", () => {
    expect(parseToken("#rows&hold=500").hold).toBe(500);
    expect(parseToken("#rows&hold=soon").hold).toBeUndefined();
  });

  // Bug: the schedule the a26 script prints opens one scene, and the arms never turn.
  it("reads a list of arms, the first one as the scene", () => {
    expect(parseToken("#arms=slope-0,slope-2&every=3&k=8")).toEqual({
      scene: "slope-0",
      k: 8,
      arms: ["slope-0", "slope-2"],
      every: 3
    });
  });
});
