/**
 * @file anim/tween — the `TweenDriver` seam of `world` and the narrower door the timeline cursor
 * starts its own tracks through. Both land in the one track table of `advance.ts`.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Entity, MotionHandle, TrackOptions, TweenDriver } from "../../world/types";
import type { AnimCtx } from "../types";
import { addedOffsets, cancelTracksOf, handleOf, startTrack } from "./advance";
import type { StepMotion } from "./types";

/** The empty field set of every track nobody muted: one frozen set, shared, read every frame. */
const NO_FIELDS: ReadonlySet<string> = Object.freeze(new Set<string>());

/**
 * The muted fields of a timeline step's track: none.
 *
 * @returns The shared empty set; a frame builds no set.
 */
function noFields(): ReadonlySet<string> {
  return NO_FIELDS;
}

/**
 * Creates the tween engine `world` runs `ViewHandle.tween`, `toRest` and `all` on. Installed with
 * `world.projection.setDriver` in `onStart`; the remover puts the instant writes back. It also
 * reports what its additive tracks add to a component right now, so `world` can compare the
 * value under a loop with the rest pose.
 *
 * @param actx - Domain context of the anim plugin.
 * @returns The driver.
 */
export function createDriver(actx: AnimCtx): TweenDriver {
  return {
    track: (
      entity: Entity,
      component: AnyComponent,
      to: Record<string, number>,
      options: TrackOptions,
      muted: () => ReadonlySet<string>
    ): MotionHandle => handleOf(actx, startTrack(actx, entity, component, to, options, muted)),

    cancelAll: (entity: Entity): void => cancelTracksOf(actx, entity),

    offsetsOf: (entity: Entity, component: AnyComponent): Readonly<Record<string, number>> =>
      addedOffsets(actx, entity, component)
  };
}

/**
 * Starts one track for a `tween` step of a timeline. The step advances it itself, so the frame
 * step leaves it alone. A step names no muted fields: the mute table belongs to the projection,
 * and a step on a view another writer owns is retargeted by field like any other track.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity to animate.
 * @param component - The component to animate.
 * @param to - The numeric target fields.
 * @param options - Duration, easing, delay and the additive flag.
 * @returns The motion of the track, advanceable by hand.
 */
export function startStepTrack(
  actx: AnimCtx,
  entity: Entity,
  component: AnyComponent,
  to: Record<string, number>,
  options: TrackOptions
): StepMotion {
  return handleOf(actx, startTrack(actx, entity, component, to, options, noFields, true));
}
