/**
 * @file world/projection — the minimal tween that plays the motion hooks until V3 `anim` takes
 * over. A track reads its start value when its delay ends and writes the exact target on the last
 * frame, so convergence is an equality check.
 */
import type { AnyComponent, Entity } from "../ecs/types";
import { applyEase } from "./easing";
import type { MotionHandle, ProjectionCtx, Track } from "./types";

/**
 * The empty field set of an unmuted component. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of field names.
 */
function noFields(): Set<string> {
  return new Set();
}

/** A handle for a hook that had nothing to animate. */
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
 * Ends a track and takes it out of the running list.
 *
 * @param pctx - Domain context of the projection module.
 * @param track - The track to end.
 */
function endTrack(pctx: ProjectionCtx, track: Track): void {
  const tracks = pctx.ctx.state.projection.tracks;
  const at = tracks.indexOf(track);

  track.ended = true;
  if (at !== -1) tracks.splice(at, 1);
}

/**
 * Writes one step of a track, skipping every muted field. At `t` of 1 the exact target is
 * written, which is what makes the convergence check an equality check.
 *
 * @param pctx - Domain context of the projection module.
 * @param track - The track to write.
 * @param t - Eased fraction between 0 and 1.
 */
function writeTrack(pctx: ProjectionCtx, track: Track, t: number): void {
  const current = pctx.deps.ecs.get(track.entity, track.component);

  if (current === undefined) {
    endTrack(pctx, track);

    return;
  }

  track.from ??= startValues(track, current);

  const muted = mutedFields(pctx, track.entity, track.component.componentName);
  const patch: Record<string, number> = {};

  for (const [field, target] of Object.entries(track.to)) {
    if (muted.has(field)) continue;

    const start = track.from[field] ?? target;

    patch[field] = t >= 1 ? target : start + (target - start) * t;
  }

  if (Object.keys(patch).length > 0) pctx.deps.ecs.set(track.entity, track.component, patch);
}

/**
 * Reads the start values of a track from the component, at the moment its delay ended.
 *
 * @param track - The track.
 * @param current - The stored component value.
 * @returns One start number per target field.
 */
function startValues(
  track: Track,
  current: Readonly<Record<string, unknown>>
): Record<string, number> {
  const from: Record<string, number> = {};

  for (const field of Object.keys(track.to)) {
    const value = current[field];

    from[field] = typeof value === "number" ? value : (track.to[field] ?? 0);
  }

  return from;
}

/**
 * Starts a track and returns its handle. `finish` writes the target now, `cancel` writes nothing;
 * both are idempotent.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to animate.
 * @param component - The component to animate.
 * @param to - The numeric target fields.
 * @param options - Duration, easing and delay.
 * @param options.ms - Duration in game milliseconds.
 * @param options.ease - Easing of the track.
 * @param options.delayMs - How long the track waits before it reads its start values.
 * @returns The motion handle.
 */
export function startTrack(
  pctx: ProjectionCtx,
  entity: Entity,
  component: AnyComponent,
  to: Record<string, number>,
  options: { ms: number; ease: Track["ease"]; delayMs: number }
): MotionHandle {
  if (Object.keys(to).length === 0) return INERT;

  const track: Track = {
    entity,
    component,
    to,
    ms: options.ms,
    ease: options.ease,
    delayMs: options.delayMs,
    elapsed: 0,
    from: undefined,
    ended: false
  };

  pctx.ctx.state.projection.tracks.push(track);

  return {
    finish: (): void => {
      if (track.ended) return;

      writeTrack(pctx, track, 1);
      endTrack(pctx, track);
    },
    cancel: (): void => {
      if (track.ended) return;

      endTrack(pctx, track);
    },
    active: (): boolean => !track.ended
  };
}

/**
 * Advances every running track by the frame delta. A track whose entity died ends silently.
 *
 * @param pctx - Domain context of the projection module.
 * @param deltaMs - The frame delta in game milliseconds.
 */
export function advanceTracks(pctx: ProjectionCtx, deltaMs: number): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const track of [...pctx.ctx.state.projection.tracks]) {
    if (track.ended) continue;

    track.elapsed += deltaMs;

    const remaining = track.elapsed - track.delayMs;

    if (remaining < 0) continue;

    const fraction = track.ms <= 0 ? 1 : Math.min(remaining / track.ms, 1);

    writeTrack(pctx, track, fraction >= 1 ? 1 : applyEase(track.ease, fraction));

    if (fraction >= 1) endTrack(pctx, track);
  }
}
