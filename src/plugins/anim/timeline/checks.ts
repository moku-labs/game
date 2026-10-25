/**
 * @file anim/timeline — the definition-time checks of the step builders: the keyframe segments, the
 * space of an additive walk and the repeat of a `tween` step, and the rule that no step follows one that never ends in a
 * `sequence`. Pure: they read plain data and throw in the `[game]` two-line form, the way
 * `checkTrack` of `defineMotion` does for its keys.
 */
import type { Step } from "./types";

/**
 * Checks the keyframe segments of a `tween` step: at least one, every `at` in 0..1, each after the
 * one before, and the last at 1, because `to` is where the walk lands.
 *
 * @param component - Name of the component the step drives, for the error.
 * @param segments - The segments the author gave.
 * @throws {Error} When the list is empty, an `at` is out of range or out of order, or the last
 *   segment ends before 1.
 * @example
 * ```ts
 * checkSegments("Transform", [{ at: 0.5 }, { at: 1 }]); // returns; [{ at: 0.5 }] throws
 * ```
 */
export function checkSegments(component: string, segments: readonly { at: number }[]): void {
  if (segments.length === 0) {
    throw new Error(
      `[game] A tween of ${component} has no segments.\n  Give it at least one segment, the last one at 1.`
    );
  }

  let previous = Number.NEGATIVE_INFINITY;

  for (const { at } of segments) {
    if (Number.isNaN(at) || at < 0 || at > 1) {
      throw new Error(
        `[game] A tween of ${component} has a segment at ${at}.\n  Keep every at between 0 and 1.`
      );
    }

    if (at <= previous) {
      throw new Error(
        `[game] A tween of ${component} has its segments out of order at ${at}.\n  Sort the segments by at, each one after the one before.`
      );
    }

    previous = at;
  }

  if (previous !== 1) {
    throw new Error(
      `[game] A tween of ${component} ends its last segment at ${previous}.\n  End the last segment at 1: to is where the walk lands.`
    );
  }
}

/**
 * Checks the space of a keyframe walk: an additive one names offsets, and the root space would
 * turn each offset as if it were a root position, so a chest under a slot at root y 500 would jump
 * by about 500 at its first segment. An additive walk stays in the local space.
 *
 * @param component - Name of the component the step drives, for the error.
 * @param additive - Whether the walk adds offsets.
 * @param space - The space the step names.
 * @throws {Error} When an additive walk names the root space.
 * @example
 * ```ts
 * checkWalkSpace("Transform", true, "local"); // returns; (…, true, "root") throws
 * ```
 */
export function checkWalkSpace(
  component: string,
  additive: boolean,
  space: "local" | "root"
): void {
  if (!additive || space === "local") return;

  throw new Error(
    `[game] An additive tween of ${component} walks segments in the root space.\n  Use space "local" for an additive walk.`
  );
}

/**
 * Checks the repeat of a `tween` step: a whole number of extra runs, 0 or more, or `"forever"`.
 *
 * @param component - Name of the component the step drives, for the error.
 * @param repeat - The repeat the author gave.
 * @throws {Error} When the repeat is negative, not whole or not a number.
 * @example
 * ```ts
 * checkRepeat("Transform", "forever"); // returns; checkRepeat("Transform", 1.5) throws
 * ```
 */
export function checkRepeat(component: string, repeat: number | "forever"): void {
  if (repeat === "forever" || (Number.isInteger(repeat) && repeat >= 0)) return;

  throw new Error(
    `[game] A tween of ${component} has repeat ${repeat}.\n  Give repeat a whole number of extra runs, 0 or more, or "forever".`
  );
}

/**
 * Tells whether a step never ends by itself: a `tween` that repeats forever, a `parallel` or a
 * `sequence` that holds one, and a `use` of one. Only a cancel or a finish ends it.
 *
 * @param step - The step to look into.
 * @returns True when the step never ends by itself.
 * @example
 * ```ts
 * neverEnds(wait(100)); // false
 * neverEnds(tween(1_048_576, Transform, { y: 0 }, { ms: 2400, repeat: "forever" })); // true
 * ```
 */
export function neverEnds(step: Step): boolean {
  switch (step.kind) {
    case "tween": {
      return step.repeat === "forever";
    }
    case "sequence":
    case "parallel": {
      return step.steps.some(child => neverEnds(child));
    }
    case "use": {
      return neverEnds(step.step);
    }
    default: {
      return false;
    }
  }
}

/**
 * Checks the children of a `sequence`: a child that never ends may only be the last one, since
 * the children after it would never play. A `parallel` takes one anywhere.
 *
 * @param steps - The children, in order.
 * @throws {Error} When a child that never ends has another child after it.
 * @example
 * ```ts
 * checkSequence([wait(100), mark("landed")]); // returns; a forever tween before the mark throws
 * ```
 */
export function checkSequence(steps: readonly Step[]): void {
  for (let index = 0; index < steps.length - 1; index++) {
    const step = steps[index];

    if (step !== undefined && neverEnds(step)) {
      throw new Error(
        `[game] Step ${index + 1} of a sequence never ends, so the steps after it would never play.\n  Put the forever step last, or run it in a parallel.`
      );
    }
  }
}
