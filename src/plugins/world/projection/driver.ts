/**
 * @file world/projection — the driver slot: `ViewHandle.tween`, `toRest` and `all` run on the
 * engine `anim` installs with `setDriver`. Without one the instant driver writes every target at
 * once, so a composition without `anim` plays every motion instantly.
 */
import type { AnyComponent, Entity } from "../ecs/types";
import type { MotionHandle, ProjectionCtx, TrackOptions, TweenDriver } from "./types";

/**
 * The empty field set of an unmuted component. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of field names.
 */
function noFields(): Set<string> {
  return new Set();
}

/** A handle for a motion that is already done. */
const INERT: MotionHandle = {
  finish: (): void => {},
  cancel: (): void => {},
  active: (): boolean => false
};

/**
 * The inert handle: already done, nothing to finish or cancel.
 *
 * @returns A handle that is never active.
 * @example
 * ```ts
 * inertHandle().active(); // false
 * ```
 */
export function inertHandle(): MotionHandle {
  return INERT;
}

/**
 * The fields another writer owns on one component of one entity.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to ask about.
 * @param name - Component name.
 * @returns The muted field names.
 */
export function mutedFields(
  pctx: ProjectionCtx,
  entity: Entity,
  name: string
): ReadonlySet<string> {
  return pctx.ctx.state.projection.mutes.get(entity)?.get(name) ?? noFields();
}

/**
 * Writes the target of a track at once, leaving out every muted field. A component the entity
 * does not carry is left alone, which is how a track on a dead entity ends silently.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to write.
 * @param component - The component to write.
 * @param to - The numeric target fields.
 * @param muted - The fields another writer owns.
 */
function writeNow(
  pctx: ProjectionCtx,
  entity: Entity,
  component: AnyComponent,
  to: Record<string, number>,
  muted: () => ReadonlySet<string>
): void {
  if (pctx.deps.ecs.get(entity, component) === undefined) return;

  const owned = muted();
  const patch: Record<string, number> = {};

  for (const [field, target] of Object.entries(to)) {
    if (!owned.has(field)) patch[field] = target;
  }

  if (Object.keys(patch).length > 0) pctx.deps.ecs.set(entity, component, patch);
}

/**
 * Creates the default driver: every track is over before it began. It is what a world plays
 * without `anim` — a unit test of the projection, a headless run, a `logicOnly` composition.
 *
 * @param pctx - Domain context of the projection module.
 * @returns The instant driver.
 */
export function createInstantDriver(pctx: ProjectionCtx): TweenDriver {
  return {
    track: (
      entity: Entity,
      component: AnyComponent,
      to: Record<string, number>,
      _options: TrackOptions,
      muted: () => ReadonlySet<string>
    ): MotionHandle => {
      writeNow(pctx, entity, component, to, muted);

      return INERT;
    },

    cancelAll: (): void => {}
  };
}

/**
 * Starts one track on the installed driver, or writes the target at once when there is none, and
 * records it so the projection knows which components are driven.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to animate.
 * @param component - The component to animate.
 * @param to - The numeric target fields.
 * @param options - Duration, easing, delay and the additive flag.
 * @returns The motion handle of the track.
 */
export function startTrack(
  pctx: ProjectionCtx,
  entity: Entity,
  component: AnyComponent,
  to: Record<string, number>,
  options: TrackOptions
): MotionHandle {
  const state = pctx.ctx.state.projection;
  const driver = state.driver ?? createInstantDriver(pctx);
  const handle = driver.track(entity, component, to, options, () =>
    mutedFields(pctx, entity, component.componentName)
  );

  if (handle.active()) {
    state.tracks.push({ entity, component: component.componentName, handle });
  }

  return handle;
}

/**
 * Ends every track of one entity, including the ones the projection never held a handle for.
 * Called when a view despawns and on every flush.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity whose tracks end.
 */
export function cancelTracks(pctx: ProjectionCtx, entity: Entity): void {
  const state = pctx.ctx.state.projection;

  state.driver?.cancelAll(entity);
  state.tracks = state.tracks.filter(track => track.entity !== entity && track.handle.active());
}

/**
 * Forgets the tracks that ended, so `looseComponents` only ever sees what still runs.
 *
 * @param pctx - Domain context of the projection module.
 */
export function forgetEndedTracks(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;

  state.tracks = state.tracks.filter(track => track.handle.active());
}

/**
 * The component names a running track drives on one entity.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to ask about.
 * @returns The names of the driven components.
 */
export function drivenComponents(pctx: ProjectionCtx, entity: Entity): Set<string> {
  forgetEndedTracks(pctx);

  const driven = noFields();

  for (const track of pctx.ctx.state.projection.tracks) {
    if (track.entity === entity) driven.add(track.component);
  }

  return driven;
}
