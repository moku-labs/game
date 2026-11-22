/**
 * @file scenes plugin — the transition of a switch (spec 36), resolved: which level of `leave` and `enter` it comes from,
 * and a new frozen object with every default filled in, which the look handed to the renderer carries. Pure: nothing is
 * written into a game's object, and nothing is called.
 */
import type { LeaveTransition } from "../renderer/types";
import type { SceneEnter, SceneLeave, SceneTransition } from "./types";

/** The milliseconds a transition takes when the game writes none. */
const DEFAULT_MS = 400;

/** The curve of a transition when the game writes none. */
const DEFAULT_EASE = "inOut";

/** The softness of the edge of a wipe, a share of the screen. */
const WIPE_SOFT = 0.04;

/** The point an iris closes into, a share of the screen on each axis. */
const IRIS_CENTRE = 0.5;

/** The softness of the edge of an iris, a share of the screen. */
const IRIS_SOFT = 0.05;

/** The cells of the noise of a dissolve across the screen. */
const DISSOLVE_SCALE = 8;

/** The width of the rim of a dissolve. */
const DISSOLVE_EDGE = 0.08;

/** The colour of the rim of a dissolve, white. */
const DISSOLVE_EDGE_COLOR = 0xff_ff_ff;

/**
 * Fills every default into a transition a game wrote, in a new frozen object the game's is never written into.
 *
 * @param transition - What the game wrote.
 * @returns The transition with every field of its kind set.
 * @example
 * ```ts
 * resolveTransition({ kind: "iris", ms: 500 });
 * // { kind: "iris", ms: 500, ease: "inOut", reduced: "cut", x: 0.5, y: 0.5, soft: 0.05 }
 * ```
 */
export function resolveTransition(
  transition: Readonly<SceneTransition>
): Readonly<LeaveTransition> {
  const common = {
    ms: transition.ms ?? DEFAULT_MS,
    ease: transition.ease ?? DEFAULT_EASE,
    reduced: transition.reduced ?? "cut"
  } as const;

  switch (transition.kind) {
    case "fade": {
      return Object.freeze({ kind: "fade", ...common });
    }
    case "slide": {
      return Object.freeze({ kind: "slide", ...common, to: transition.to ?? "left" });
    }
    case "wipe": {
      return Object.freeze({
        kind: "wipe",
        ...common,
        angle: transition.angle ?? 0,
        soft: transition.soft ?? WIPE_SOFT
      });
    }
    case "iris": {
      return Object.freeze({
        kind: "iris",
        ...common,
        x: transition.x ?? IRIS_CENTRE,
        y: transition.y ?? IRIS_CENTRE,
        soft: transition.soft ?? IRIS_SOFT
      });
    }
    case "dissolve": {
      return Object.freeze({
        kind: "dissolve",
        ...common,
        scale: transition.scale ?? DISSOLVE_SCALE,
        edge: transition.edge ?? DISSOLVE_EDGE,
        edgeColor: transition.edgeColor ?? DISSOLVE_EDGE_COLOR
      });
    }
  }
}

/**
 * The transition one level of `leave` writes over the level below it: nothing keeps the level below, `leave: false` and
 * `transition: false` turn it off, an object replaces it whole.
 *
 * @param below - The transition of the levels below: one, `false` for off, `undefined` for none written.
 * @param leave - What the level writes.
 * @returns The transition of the levels up to this one.
 * @example
 * ```ts
 * transitionOver({ kind: "fade" }, { transition: false }); // false
 * ```
 */
function transitionOver(
  below: SceneTransition | false | undefined,
  leave: SceneLeave | undefined
): SceneTransition | false | undefined {
  if (leave === undefined) return below;
  if (leave === false) return false;

  return leave.transition === undefined ? below : leave.transition;
}

/**
 * Resolves the transition of a switch: the `enter.transition` of the scene being entered, else the `leave.transition` of
 * the scene being left, else the one of `config.leave`, else none. `false` the scene being left (or the config, until the
 * scene writes one) resolves to, from `leave: false` or `transition: false`, gives none, and `enter` never turns a
 * transition on over it. A level replaces the one below whole: no field is merged.
 *
 * @param config - `config.leave`.
 * @param scene - The `leave` of the scene being left, for this switch.
 * @param enter - The `enter` of the scene being entered.
 * @returns The transition with every default filled in, a new frozen object; `undefined` for none.
 * @example
 * ```ts
 * transitionOf({ transition: { kind: "fade" } }, undefined, { transition: { kind: "iris", ms: 500 } })?.kind; // "iris"
 * ```
 */
export function transitionOf(
  config: SceneLeave | undefined,
  scene: SceneLeave | undefined,
  enter: SceneEnter | undefined
): Readonly<LeaveTransition> | undefined {
  const left = transitionOver(transitionOver(undefined, config), scene);

  if (left === false) return undefined;

  const chosen = enter?.transition ?? left;

  return chosen === undefined ? undefined : resolveTransition(chosen);
}
