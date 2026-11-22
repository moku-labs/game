import { describe, expect, it } from "vitest";
import { EASE_NAMES } from "../../../world/projection/easing";
import { defineScene } from "../../define";
import { checkConfig } from "../../lifecycle";
import type { SceneEnter, SceneLeave } from "../../types";

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

  // Bug F160: `config.leave` takes the function form too: a config has no scene to name in `from`, so the engine would
  // call it with a switch of nothing.
  it("refuses a function in the config, where `leave` stays static", () => {
    expect(() =>
      checkConfig({ buildMs: "auto", leave: (() => undefined) as unknown as SceneLeave })
    ).toThrow("Give { cover, loader } or false");
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

describe("the checks of `leave.loader.holdMs`", () => {
  // Bug: a floor of the wrong shape reaches the switch: `until` is NaN, so the swap never comes and the switch hangs.
  it.each([
    ["-1", -1],
    ["NaN", Number.NaN],
    ['"260"', "260"]
  ])("refuses %s, naming the field", (_case, holdMs) => {
    const leave = { loader: { holdMs } } as SceneLeave;

    expect(() => checkConfig({ buildMs: "auto", leave })).toThrow(
      `[game] scenes.leave.loader.holdMs is ${String(holdMs)}.\n  Give the milliseconds the swap waits for, 0 or more.`
    );
  });

  // Bug: 0 is refused, so a scene cannot lift the floor of the config.
  it("takes 0, the value that lifts a floor", () => {
    expect(() => checkConfig({ buildMs: "auto", leave: { loader: { holdMs: 0 } } })).not.toThrow();
  });
});

describe("the checks of `enter`", () => {
  // Bug: a scene's wrong `enter.cover` reaches the renderer at its first switch: a veil that never shows, or a colour
  // Pixi reads as another.
  it.each([
    [
      "an alpha over 1",
      { cover: { alpha: 2 } },
      'Scene "x": enter.cover.alpha is 2.\n  Give the alpha the veil fades in to, a number from 0 to 1.'
    ],
    [
      "a colour that is no whole number",
      { cover: { color: 0.5 } },
      'Scene "x": enter.cover.color is 0.5.\n  Give a colour from 0x000000 to 0xffffff.'
    ],
    ["an enter that is no object", 3, 'Scene "x": enter is 3.\n  Give { cover }.']
  ])("refuses %s at defineScene, naming the scene", (_case, enter, message) => {
    expect(() =>
      defineScene("x", { bundle: "x", layers: {}, projections: [], enter: enter as SceneEnter })
    ).toThrow(`[game] ${message}`);
  });
});

/** The check of a transition at the three places a game writes one: the config, a scene's `leave`, a scene's `enter`. */
const PLACES = [
  [
    "scenes.leave.transition",
    (transition: unknown) => checkConfig({ buildMs: "auto", leave: { transition } as SceneLeave })
  ],
  [
    'Scene "x": leave.transition',
    (transition: unknown) =>
      defineScene("x", {
        bundle: "x",
        layers: {},
        projections: [],
        leave: { transition } as SceneLeave
      })
  ],
  [
    'Scene "x": enter.transition',
    (transition: unknown) =>
      defineScene("x", {
        bundle: "x",
        layers: {},
        projections: [],
        enter: { transition } as SceneEnter
      })
  ]
] as const;

describe("the checks of a transition (spec 36)", () => {
  // Bug: a value out of its range reaches the renderer: a transition that never ends (ms 5001 and more freezes the new
  // scene under a picture for seconds), divides by zero (ms 0), or writes NaN into a uniform (soft 1.01, a NaN angle).
  describe("written in the config", () => {
    const [where, check] = PLACES[0];

    it.each([
      ["kind", { kind: "spin" }, "spin", "one of"],
      ["kind", {}, "undefined", "one of"],
      ["ms", { kind: "fade", ms: 0 }, "0", "more than 0"],
      ["ms", { kind: "fade", ms: -1 }, "-1", "more than 0"],
      ["ms", { kind: "fade", ms: 5001 }, "5001", "at most 5000"],
      ["ms", { kind: "fade", ms: Number.NaN }, "NaN", "more than 0"],
      ["ms", { kind: "fade", ms: "400" }, "400", "more than 0"],
      ["ease", { kind: "fade", ease: "bounce" }, "bounce", "a function"],
      ["reduced", { kind: "fade", reduced: "skip" }, "skip", '"cut" or "keep"'],
      ["to", { kind: "slide", to: "diagonal" }, "diagonal", '"left", "right", "up" or "down"'],
      ["angle", { kind: "wipe", angle: Number.POSITIVE_INFINITY }, "Infinity", "finite"],
      ["soft", { kind: "wipe", soft: 1.01 }, "1.01", "from 0 to 1"],
      ["soft", { kind: "wipe", soft: -0.01 }, "-0.01", "from 0 to 1"],
      ["x", { kind: "iris", x: 1.01 }, "1.01", "from 0 to 1"],
      ["y", { kind: "iris", y: -0.1 }, "-0.1", "from 0 to 1"],
      ["soft", { kind: "iris", soft: 2 }, "2", "from 0 to 1"],
      ["scale", { kind: "dissolve", scale: 0 }, "0", "above 0"],
      ["scale", { kind: "dissolve", scale: Number.POSITIVE_INFINITY }, "Infinity", "above 0"],
      ["edge", { kind: "dissolve", edge: 1.5 }, "1.5", "from 0 to 1"],
      ["edgeColor", { kind: "dissolve", edgeColor: 0x1_00_00_00 }, String(0x1_00_00_00), "colour"],
      ["edgeColor", { kind: "dissolve", edgeColor: 0.5 }, "0.5", "colour"]
    ])("refuses %s of %j", (field, transition, shown, hint) => {
      expect(() => check(transition)).toThrow(`[game] ${where}.${field} is ${shown}.\n  Give `);
      expect(() => check(transition)).toThrow(hint);
    });

    // Bug: a boundary one step too tight refuses what the spec allows: a soft edge of 1, an iris at a corner.
    it.each([
      { kind: "fade" },
      { kind: "fade", ms: 5000, ease: "outBack", reduced: "keep" },
      { kind: "fade", ms: 1, ease: (t: number) => t * t, reduced: "cut" },
      { kind: "slide", to: "down" },
      { kind: "wipe", angle: -Math.PI, soft: 0 },
      { kind: "wipe", angle: 1e9, soft: 1 },
      { kind: "iris", x: 0, y: 1, soft: 1 },
      { kind: "dissolve", scale: 0.001, edge: 0, edgeColor: 0 },
      { kind: "dissolve", scale: 64, edge: 1, edgeColor: 0xff_ff_ff }
    ])("takes %j", transition => {
      expect(() => check(transition)).not.toThrow();
    });

    // Bug: every named curve of the world's `Ease` must pass, or a name `applyEase` knows is refused.
    it.each(EASE_NAMES)("takes the curve %s", ease => {
      expect(() => check({ kind: "fade", ease })).not.toThrow();
    });

    // Bug: a field of another kind passes in silence and the author thinks it does something (an `angle` on a slide).
    it.each([
      ["fade", { kind: "fade", angle: 1 }, "angle", "kind, ms, ease and reduced"],
      ["slide", { kind: "slide", soft: 0.1 }, "soft", "kind, ms, ease, reduced and to"],
      ["wipe", { kind: "wipe", x: 0.5 }, "x", "kind, ms, ease, reduced, angle and soft"],
      ["iris", { kind: "iris", angle: 1 }, "angle", "kind, ms, ease, reduced, x, y and soft"],
      [
        "dissolve",
        { kind: "dissolve", to: "left" },
        "to",
        "kind, ms, ease, reduced, scale, edge and edgeColor"
      ],
      ["fade", { kind: "fade", colour: 1 }, "colour", "kind, ms, ease and reduced"]
    ])("refuses a field a %s does not take: %j", (kind, transition, field, fields) => {
      expect(() => check(transition)).toThrow(`[game] ${where}.${field} is `);
      expect(() => check(transition)).toThrow(`A "${kind}" transition takes ${fields}`);
    });

    it.each([
      ["a number", 5],
      ["a string", "fade"],
      ["an array", [{ kind: "fade" }]]
    ])("refuses %s in the place of the object", (_case, transition) => {
      expect(() => check(transition)).toThrow(`[game] ${where} is `);
    });

    it("takes none", () => {
      expect(() => check(undefined)).not.toThrow();
    });
  });

  // Bug: a place of the three (the config, the scene's `leave`, the scene's `enter`) skips the check or names another
  // place, so the author is sent to the wrong line.
  it.each(PLACES)("is checked where it is written, naming %s", (where, check) => {
    expect(() => check({ kind: "fade", ms: 5001 })).toThrow(`[game] ${where}.ms is 5001.`);
    expect(() => check({ kind: "slide", angle: 1 })).toThrow(`[game] ${where}.angle is 1.`);
    expect(() => check({ kind: "fade", ms: 5000 })).not.toThrow();
  });

  // Bug: `false` is refused where it turns the transition off, or taken where it can mean nothing (an `enter`).
  it("takes `false` at the config and the scene's `leave`, and refuses it at `enter`", () => {
    expect(() => PLACES[0][1](false)).not.toThrow();
    expect(() => PLACES[1][1](false)).not.toThrow();
    expect(() => PLACES[2][1](false)).toThrow('[game] Scene "x": enter.transition is false.');
  });

  // Bug: the veil's own rules stop running once a transition is written beside it.
  it("keeps checking the veil beside a transition", () => {
    expect(() =>
      checkConfig({ buildMs: "auto", leave: { cover: { alpha: 2 }, transition: { kind: "fade" } } })
    ).toThrow("scenes.leave.cover.alpha is 2");
  });
});
