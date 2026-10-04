import { describe, expect, it } from "vitest";
import type { Hint } from "../../../flow/types";
import { hintFor } from "../../jsx/hints";

// ---------------------------------------------------------------------------
// Unit test: the routing of a released hint to a keyed element, the rule of
// world/projection/hints.ts applied to the roots of ui
// ---------------------------------------------------------------------------

/** The flight of coins to the HUD counter. */
const coinsFly: Hint = {
  kind: "coins.fly",
  payload: { projection: "hud", key: "coinPillText", ms: 400 },
  hint: true
};

describe("hintFor", () => {
  it("routes a hint whose payload names the projection and the key", () => {
    expect(hintFor([coinsFly], "hud", "coinPillText")).toBe(coinsFly);
  });

  it("routes a hint without projection to every root that has the key", () => {
    const bump: Hint = { kind: "bump", payload: { key: "claim" }, hint: true };

    expect(hintFor([bump], "hud", "claim")).toBe(bump);
    expect(hintFor([bump], "Reward", "claim")).toBe(bump);
  });

  it("skips a hint that names another projection", () => {
    expect(hintFor([coinsFly], "home.screen", "coinPillText")).toBeUndefined();
  });

  it("takes the first of two hints for one key", () => {
    const second: Hint = { ...coinsFly, kind: "coins.again" };

    expect(hintFor([coinsFly, second], "hud", "coinPillText")).toBe(coinsFly);
  });

  it("gives an unkeyed element no hint", () => {
    expect(hintFor([coinsFly], "hud", undefined)).toBeUndefined();
  });

  it("never reads the projection field as a key", () => {
    expect(hintFor([coinsFly], "hud", "hud")).toBeUndefined();
  });

  it("drops a hint whose payload is no object", () => {
    const bare: Hint = { kind: "shake", hint: true };
    const listed: Hint = { kind: "shake", payload: ["coinPillText"], hint: true };

    expect(hintFor([bare, listed], "hud", "coinPillText")).toBeUndefined();
  });
});
