import { describe, expect, it } from "vitest";
import { defineScene } from "../../define";
import { checkConfig } from "../../lifecycle";
import type { SceneLeave } from "../../types";

// ---------------------------------------------------------------------------
// Unit test of the checks of a `leave` a game wrote (spec 33, slice A2): in the config at `createApp` (`onInit`) and
// in a scene at `defineScene`, every field of the wrong shape refused where it was written, in the engine's two-line
// format.
// ---------------------------------------------------------------------------

describe("the checks of `leave`", () => {
  // Bug: a wrong value reaches the renderer and draws a veil that never fades, or never shows.
  it.each([
    ["a string", "dim", "scenes.leave is dim."],
    ["a part that is no object", { loader: 400 }, "scenes.leave.loader is 400."],
    ["an alpha over 1", { cover: { alpha: 2 } }, "scenes.leave.cover.alpha is 2."],
    [
      "a colour that is no whole number",
      { cover: { color: 0.5 } },
      "scenes.leave.cover.color is 0.5."
    ],
    ["a negative duration", { cover: { inMs: -1 } }, "scenes.leave.cover.inMs is -1."],
    [
      "a delay that is no number",
      { loader: { afterMs: "soon" } },
      "scenes.leave.loader.afterMs is soon."
    ],
    ["an empty texture key", { loader: { texture: "" } }, "scenes.leave.loader.texture is ."]
  ])("refuses %s in the config at createApp", (_case, leave, message) => {
    expect(() => checkConfig({ buildMs: "auto", leave: leave as SceneLeave })).toThrow(
      `[game] ${message}\n  Give `
    );
  });

  // Bug: a scene's wrong `leave` throws only at its first switch, far from the line that wrote it.
  it("refuses a scene's `leave` of the wrong shape at `defineScene`, naming the scene", () => {
    expect(() =>
      defineScene("board", {
        bundle: "board",
        layers: {},
        projections: [],
        leave: { cover: { outMs: Number.NaN } }
      })
    ).toThrow(
      '[game] Scene "board": leave.cover.outMs is NaN.\n  Give the milliseconds of the fade-out, 0 or more.'
    );
  });
});
