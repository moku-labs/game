/**
 * @file anim/tween — the `TweenDriver` seam of `world` and the narrower door the timeline cursor
 * starts its own tracks through. Both land in the one track table of `advance.ts`.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Entity, MotionHandle, TrackOptions, TweenDriver } from "../../world/types";
import type { AnimCtx } from "../types";
import { cancelTracksOf, handleOf, startTrack } from "./advance";
import type { StepMotion } from "./types";

/**
 * The empty field set of a track nobody muted. It lives in its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of field names.
 */
function noFields(): ReadonlySet<string> {
  return new Set();
}

/**
 * Creates the tween engine `world` runs `ViewHandle.tween`, `toRest` and `all` on. Installed with
 * `world.projection.setDriver` in `onStart`; the remover puts the instant writes back.
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

    cancelAll: (entity: Entity): void => cancelTracksOf(actx, entity)
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
