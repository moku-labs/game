import { describe, expect, it } from "vitest";
import { leaveOf } from "../../leave";
import { resolveTransition, transitionOf } from "../../transition";
import type { SceneEnter, SceneLeave, SceneTransition } from "../../types";

// ---------------------------------------------------------------------------
// Unit test of the transition a switch resolves (spec 36): which level wins (the scene entered, the scene left, the
// config), `false` and the veil's `leave: false`, every default filled into a new frozen object, and the look a
// transition alone makes.
// ---------------------------------------------------------------------------

/**
 * A curve a game writes as a function.
 *
 * @param t - The time, 0..1.
 * @returns The progress.
 */
function ease(t: number): number {
  return t * t;
}

/** The fields every transition resolves to when the game writes none of them. */
const COMMON = { ms: 400, ease: "inOut", reduced: "cut" };

describe("the defaults of a transition", () => {
  // Bug: a default drifts from the spec (400 ms, "inOut", cut under reduced motion, 8 cells...), and a game that writes
  // only `kind` gets another transition than the README says.
  it.each([
    [{ kind: "fade" }, { kind: "fade", ...COMMON }],
    [{ kind: "slide" }, { kind: "slide", ...COMMON, to: "left" }],
    [{ kind: "wipe" }, { kind: "wipe", ...COMMON, angle: 0, soft: 0.04 }],
    [{ kind: "iris" }, { kind: "iris", ...COMMON, x: 0.5, y: 0.5, soft: 0.05 }],
    [
      { kind: "dissolve" },
      { kind: "dissolve", ...COMMON, scale: 8, edge: 0.08, edgeColor: 0xff_ff_ff }
    ]
  ] as const)("fills every field of %j", (written, resolved) => {
    expect(resolveTransition(written)).toEqual(resolved);
  });

  // Bug: a written value is replaced by the default (`??` read as `||` drops a 0, an `angle` of 0 or a soft edge of 0).
  it("keeps what the game wrote, a 0 and a function ease included", () => {
    expect(
      resolveTransition({ kind: "wipe", ms: 5000, ease, reduced: "keep", angle: 0, soft: 0 })
    ).toEqual({ kind: "wipe", ms: 5000, ease, reduced: "keep", angle: 0, soft: 0 });
    expect(resolveTransition({ kind: "dissolve", edge: 0, edgeColor: 0 })).toMatchObject({
      edge: 0,
      edgeColor: 0
    });
    expect(resolveTransition({ kind: "slide", to: "down" })).toMatchObject({ to: "down" });
    expect(resolveTransition({ kind: "iris", x: 0, y: 1 })).toMatchObject({ x: 0, y: 1 });
  });

  // Bug: the resolved object is the game's own (the engine writes defaults into a game's object, or shares one object
  // between two switches that then change each other), or it is left open for the renderer to change.
  it("makes a new frozen object and leaves the game's alone", () => {
    const written: SceneTransition = { kind: "iris", ms: 500 };
    const resolved = resolveTransition(written);

    expect(resolved).not.toBe(written);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(written).toEqual({ kind: "iris", ms: 500 });
    expect(Object.isFrozen(written)).toBe(false);
    expect(resolveTransition(written)).not.toBe(resolved);
  });
});

describe("the level a transition comes from", () => {
  const config: SceneLeave = { transition: { kind: "fade", ms: 100 } };
  const left: SceneLeave = { transition: { kind: "slide", ms: 200 } };
  const entered: SceneEnter = { transition: { kind: "iris", ms: 300 } };

  /**
   * The `kind` and `ms` the switch resolves, or `undefined` for none.
   *
   * @param levels - The config's `leave`, the left scene's, the entered scene's `enter`.
   * @returns What `transitionOf` resolved, cut to the two fields.
   */
  function pick(levels: [SceneLeave | undefined, SceneLeave | undefined, SceneEnter | undefined]) {
    const resolved = transitionOf(...levels);

    return resolved === undefined ? undefined : { kind: resolved.kind, ms: resolved.ms };
  }

  // Bug: the wrong level wins: the scene entered is read last, or the config over the scene.
  it("takes the scene entered, else the scene left, else the config", () => {
    expect(pick([config, left, entered])).toEqual({ kind: "iris", ms: 300 });
    expect(pick([config, left, undefined])).toEqual({ kind: "slide", ms: 200 });
    expect(pick([config, undefined, undefined])).toEqual({ kind: "fade", ms: 100 });
    expect(pick([config, { cover: false }, undefined])).toEqual({ kind: "fade", ms: 100 });
    expect(pick([undefined, left, entered])).toEqual({ kind: "iris", ms: 300 });
    expect(pick([undefined, undefined, entered])).toEqual({ kind: "iris", ms: 300 });
  });

  // Bug: a level replaces the one below field by field (a merge): a scene's `{ kind: "slide" }` keeps the config's `ms`.
  it("replaces the transition of the level below whole, never merges its fields", () => {
    expect(
      transitionOf(
        { transition: { kind: "fade", ms: 100 } },
        { transition: { kind: "slide" } },
        undefined
      )
    ).toMatchObject({ kind: "slide", ms: 400 });
  });

  it("is none when no level writes one", () => {
    expect(pick([undefined, undefined, undefined])).toBeUndefined();
    expect(pick([{ cover: false }, { loader: false }, { cover: { alpha: 0.2 } }])).toBeUndefined();
  });

  // Bug: `enter` turns on a transition the scene left set to `false` (decision 1), so a map that wants none gets the
  // iris of the night.
  it("is none for `transition: false` of the scene left, whatever the scene entered writes", () => {
    expect(pick([config, { transition: false }, entered])).toBeUndefined();
    expect(pick([undefined, { transition: false }, entered])).toBeUndefined();
  });

  // Bug: `leave: false` of the scene left turns off the veil and the loader but a transition still plays.
  it("is none for `leave: false` of the scene left, whatever the config and the scene entered write", () => {
    expect(pick([config, false, entered])).toBeUndefined();
    expect(pick([config, false, undefined])).toBeUndefined();
  });

  // Bug: the game-wide `leave: false` or `transition: false` is read as "nothing written" and `enter` turns a transition
  // on under it, as it never turns a veil on over `cover: false`.
  it("stays off under a config that turns it off, until the scene left writes one", () => {
    expect(pick([false, undefined, entered])).toBeUndefined();
    expect(pick([{ transition: false }, undefined, entered])).toBeUndefined();
    expect(pick([false, left, undefined])).toEqual({ kind: "slide", ms: 200 });
    expect(pick([{ transition: false }, left, entered])).toEqual({ kind: "iris", ms: 300 });
  });
});

describe("the look a transition makes", () => {
  // Bug: a switch with a transition and neither veil nor loader shows no look, so no transition is ever asked for.
  it("answers a look of the transition alone when the veil and the loader are both off", () => {
    expect(
      leaveOf({ cover: false, loader: false, transition: { kind: "fade" } }, undefined)
    ).toEqual({ cover: false, loader: false, transition: { kind: "fade", ...COMMON } });
    expect(
      leaveOf({ cover: false, loader: false }, undefined, { transition: { kind: "fade" } })
    ).toEqual({
      cover: false,
      loader: false,
      transition: { kind: "fade", ...COMMON }
    });
  });

  // Bug: the look of a game that writes no transition gains a `transition` key, and every existing switch changes.
  it("adds no field to a look without one", () => {
    expect(leaveOf(undefined, undefined)).not.toHaveProperty("transition");
    expect(leaveOf({ cover: false, loader: false }, undefined)).toBeUndefined();
  });

  // Bug: `leave: false` of the scene left shows the transition of the scene entered.
  it("shows nothing for `leave: false` of the scene left, a transition of the scene entered or not", () => {
    expect(leaveOf(undefined, false, { transition: { kind: "fade" } })).toBeUndefined();
  });

  // Bug: the veil's resolve and the transition's get mixed up: a scene that turns the transition off loses its veil.
  it("keeps the veil and the loader when only the transition is off", () => {
    expect(leaveOf(undefined, { transition: false })).toEqual({
      cover: { color: 0, alpha: 0.45, inMs: 50, outMs: 150 },
      loader: { afterMs: 400 }
    });
  });
});
