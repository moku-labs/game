/**
 * @file anim/tween — the one track table: starting a track, the retarget policy per field, the
 * offsets accumulator of the additive tracks, the per-frame advance with its repeats, reduced
 * motion and the two ways out. Deterministic: the only clock is the `delta` a caller hands in.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Ease, Entity, TrackOptions, TrackSegment } from "../../world/types";
import { Animation, countPlaying } from "../components";
import type { AnimCtx } from "../types";
import { applyEase } from "./easing";
import type { StepMotion, Track } from "./types";

/**
 * The key one field of one component of one entity is booked under.
 *
 * @param entity - The entity.
 * @param component - Component name.
 * @param field - Field name.
 * @returns The key of the owner and offsets tables.
 * @example
 * ```ts
 * fieldKey(1_048_576, "Transform", "x"); // "1048576:Transform:x"
 * ```
 */
export function fieldKey(entity: Entity, component: string, field: string): string {
  return `${entity}:${component}:${field}`;
}

/**
 * The key of every field of a new track, built once so a frame writes without building strings.
 *
 * @param entity - The entity.
 * @param component - Component name.
 * @param fields - The target fields of the track.
 * @returns The key per field.
 * @example
 * ```ts
 * keysOf(1_048_576, "Transform", { x: 10 }); // { x: "1048576:Transform:x" }
 * ```
 */
function keysOf(
  entity: Entity,
  component: string,
  fields: Record<string, number>
): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const field of Object.keys(fields)) keys[field] = fieldKey(entity, component, field);

  return keys;
}

/**
 * The key a track books one of its fields under: the one `startTrack` built.
 *
 * @param track - The track.
 * @param field - One of its fields.
 * @returns The key of the owner, bases and offsets tables.
 */
function keyOf(track: Track, field: string): string {
  return track.keys[field] ?? fieldKey(track.entity, track.component.componentName, field);
}

/**
 * Creates the offsets table of one field. It lives in its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @returns The table of track id to contributed delta.
 */
function offsetsOf(actx: AnimCtx, key: string): Map<number, number> {
  const offsets = actx.state.offsets.get(key) ?? new Map<number, number>();

  actx.state.offsets.set(key, offsets);

  return offsets;
}

/**
 * The sum of what every additive track contributes to one field.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @returns The sum, `0` when no additive track drives the field.
 */
function sumOffsets(actx: AnimCtx, key: string): number {
  const offsets = actx.state.offsets.get(key);

  if (offsets === undefined) return 0;

  let sum = 0;

  for (const delta of offsets.values()) sum += delta;

  return sum;
}

/**
 * What the running additive tracks of one component of one entity add to each of its fields
 * right now: the offset of a loop. The `TweenDriver` seam hands it to `world`, which takes it off
 * the stored value before it compares a view with its rest pose. A field no additive track adds
 * to is left out.
 *
 * A field another writer owns keeps the offset of the last write of its track. That is what
 * stands in the field while the writer only holds it, and what the track adds again when the
 * field is given back. So a view the hand held still reads as home, and a view the hand put
 * somewhere reads as moved.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity to ask about.
 * @param component - The component to ask about.
 * @returns Field name to the sum of the offsets on it.
 */
export function addedOffsets(
  actx: AnimCtx,
  entity: Entity,
  component: AnyComponent
): Record<string, number> {
  const sums: Record<string, number> = {};

  // Only the additive tracks of this entity are walked: the world asks for every view it compares.
  for (const track of actx.state.additive.get(entity) ?? []) {
    if (track.component.componentName !== component.componentName) continue;

    for (const field of Object.keys(track.to)) sums[field] = sumOffsets(actx, keyOf(track, field));
  }

  return sums;
}

/**
 * Files a new additive track under its entity, so `addedOffsets` finds it without a walk of the
 * whole track table.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The additive track that starts.
 */
function fileAdditive(actx: AnimCtx, track: Track): void {
  const tracks = actx.state.additive.get(track.entity) ?? new Set<Track>();

  tracks.add(track);
  actx.state.additive.set(track.entity, tracks);
}

/**
 * Takes an ended additive track out of the table of its entity, and the entity with its last one.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that ended.
 */
function unfileAdditive(actx: AnimCtx, track: Track): void {
  const tracks = actx.state.additive.get(track.entity);

  if (tracks?.delete(track) === true && tracks.size === 0) actx.state.additive.delete(track.entity);
}

/**
 * Reads the start values of a track, once, when its delay has ended. The base of a field another
 * track already drives is used, so an additive offset is never folded into a start value.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that is about to write.
 * @param stored - The stored component value.
 * @returns The start value per field.
 */
function readFrom(
  actx: AnimCtx,
  track: Track,
  stored: Readonly<Record<string, unknown>>
): Record<string, number> {
  if (track.from !== undefined) return track.from;

  const from: Record<string, number> = {};

  for (const [field, target] of Object.entries(track.to)) {
    const key = keyOf(track, field);
    const base = actx.state.bases.get(key);
    const current = stored[field];
    const value = base ?? (typeof current === "number" ? current : target);

    from[field] = value;
    if (base === undefined) actx.state.bases.set(key, value);
  }

  track.from = from;

  return from;
}

/**
 * Walks the keyframe segments of a track to one normalised time of the whole track. Each segment
 * eases, with its own curve or the track's, from where the segment before left the field; a
 * segment that does not name the field holds it, and past the last segment the field holds too.
 *
 * @param segments - The segments of the track, in order.
 * @param ease - The curve of a segment that names none.
 * @param field - The field to read.
 * @param start - The value the track started from.
 * @param fraction - Normalised time of the whole track.
 * @returns The value of the field.
 * @example
 * ```ts
 * walkValue([{ at: 0.5, to: { x: 100 } }, { at: 1, to: { x: 50 } }], "linear", "x", 0, 0.75); // 75
 * ```
 */
function walkValue(
  segments: readonly TrackSegment[],
  ease: Ease,
  field: string,
  start: number,
  fraction: number
): number {
  let from = start;
  let fromAt = 0;

  for (const segment of segments) {
    const target = segment.to[field] ?? from;

    if (fraction <= segment.at) {
      const span = segment.at - fromAt;
      const t = span <= 0 ? 1 : (fraction - fromAt) / span;

      // On the key itself the value is the key's, exactly: no float drift from `from + Δ × 1`.
      if (t >= 1) return target;

      return from + (target - from) * applyEase(segment.ease ?? ease, t);
    }

    from = target;
    fromAt = segment.at;
  }

  return from;
}

/**
 * The value one field of a track takes at one normalised time: eased straight from the start to
 * the target, or along the keyframe segments.
 *
 * @param track - The track.
 * @param field - The field to read.
 * @param start - The value the walk starts from: the start value, or 0 for an offset walk.
 * @param target - The value the track ends on.
 * @param fraction - Normalised time of the whole track.
 * @returns The value of the field.
 */
function fieldValue(
  track: Track,
  field: string,
  start: number,
  target: number,
  fraction: number
): number {
  if (track.segments === undefined) {
    return start + (target - start) * applyEase(track.ease, fraction);
  }

  return walkValue(track.segments, track.ease, field, start, fraction);
}

/**
 * Tells whether another writer owns a field at this write, so the track leaves it alone. An
 * additive track remembers that it skipped the field: it has to find the value under it again
 * once the field is given back.
 *
 * @param track - The track that is about to write.
 * @param owned - The fields another writer owns now.
 * @param field - The field.
 * @returns True when the track must not write the field.
 */
function skipsOwned(track: Track, owned: ReadonlySet<string>, field: string): boolean {
  if (!owned.has(field)) return false;
  if (track.additive) track.masked.add(field);

  return true;
}

/**
 * How far a field may sit from the value the table last wrote into it and still count as
 * untouched by another writer. The same size as the rest tolerance of `world`.
 */
const UNTOUCHED = 1e-6;

/**
 * Books what an additive track adds to one field in this frame. On its first write after another
 * writer gave the field back it also moves the base of the field, when that writer moved the
 * field. While the field was owned, the track did not write it and the other writer put it where
 * it wanted, so the base the table kept is stale: a hand dragged a bobbing view away. The value
 * that stands in the field becomes what the base and the offsets add up to. So this write leaves
 * the field where it is, the track runs on from there, and a track that starts now to bring the
 * field home reads that value as its start. Without it the field would jump back to the old base
 * in one frame.
 *
 * A writer that only held the field left in it what the table last wrote: the base plus the
 * offsets as they stood. Then nothing moved the value under the track, and the base stays.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The additive track.
 * @param field - The field.
 * @param delta - What the track adds to the field now.
 * @param left - The value that stands in the field before this write.
 */
function addOffset(actx: AnimCtx, track: Track, field: string, delta: number, left: unknown): void {
  const key = keyOf(track, field);
  const written = (actx.state.bases.get(key) ?? 0) + sumOffsets(actx, key);

  offsetsOf(actx, key).set(track.id, delta);

  if (!track.masked.delete(field) || typeof left !== "number") return;
  if (Math.abs(left - written) <= UNTOUCHED) return;

  actx.state.bases.set(key, left - sumOffsets(actx, key));
}

/**
 * Tells whether a field already holds the value a track would write into it. Two NaN are the same
 * value, so a field that stands on NaN is not written again every frame. A value that is not a
 * number differs from every number.
 *
 * @param stored - What the field of the stored component holds.
 * @param next - What the track would write.
 * @returns True when writing `next` changes nothing.
 * @example
 * ```ts
 * same(0.6, 0.6); // true
 * same(Number.NaN, Number.NaN); // true
 * same("0.6", 0.6); // false
 * ```
 */
function same(stored: unknown, next: number): boolean {
  return stored === next || (Number.isNaN(stored) && Number.isNaN(next));
}

/**
 * Writes one frame of a track: the eased value for an absolute track, the contributed delta for
 * an additive one, and in both cases the base plus every offset of the field. A component the
 * entity no longer carries ends the track silently.
 *
 * An additive keyframe walk names offsets: it starts at no offset and each segment gives the
 * delta it adds over the base, so a loop keeps its shape whatever pose it started on. A straight
 * additive track still adds the way from its start value to its target.
 *
 * A field another writer owns is left alone. An additive track remembers that it skipped the
 * field, and adds to the value it finds there once the field is given back.
 *
 * A field whose value is the one the component holds is not written, and nothing is written when
 * no field changed, so a holding loop marks nothing changed. The bases and offsets are booked
 * every frame all the same.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to write.
 * @param fraction - Normalised time of the track.
 * @param final - True on the last frame, which writes the exact target.
 */
function writeFields(actx: AnimCtx, track: Track, fraction: number, final: boolean): void {
  const ecs = actx.deps.world.ecs;
  const stored = ecs.get(track.entity, track.component);

  if (stored === undefined) {
    endTrack(actx, track);

    return;
  }

  const from = readFrom(actx, track, stored);
  const owned = track.muted();
  const walksOffsets = track.additive && track.segments !== undefined;
  let patch: Record<string, number> | undefined;

  // `for…in` and not `Object.entries`: no array of pairs per track per frame. `to` is a plain
  // record of own fields.
  for (const field in track.to) {
    const target = track.to[field];

    if (target === undefined || skipsOwned(track, owned, field)) continue;

    const key = keyOf(track, field);
    const start = from[field] ?? target;
    const origin = walksOffsets ? 0 : start;
    const value = final ? target : fieldValue(track, field, origin, target, fraction);

    if (track.additive) addOffset(actx, track, field, value - origin, stored[field]);
    else actx.state.bases.set(key, value);

    const next = (actx.state.bases.get(key) ?? start) + sumOffsets(actx, key);

    if (!same(stored[field], next)) {
      patch ??= {};
      patch[field] = next;
    }
  }

  if (patch !== undefined) ecs.set(track.entity, track.component, patch);
}

/**
 * Releases the field bookkeeping of a track that is ending: the fields it owned, its own offsets
 * and the base of a field nothing drives any more.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that ends.
 * @param stored - The stored component value, or `undefined` when the entity no longer carries it.
 * @returns The fields whose last additive track just left and that stand off their base, with
 *   the base to write them back to; `undefined` when no field has to be written.
 */
function releaseFields(
  actx: AnimCtx,
  track: Track,
  stored: Readonly<Record<string, unknown>> | undefined
): Record<string, number> | undefined {
  const owned = track.muted();
  let clean: Record<string, number> | undefined;

  for (const field of Object.keys(track.to)) {
    const key = keyOf(track, field);
    const offsets = actx.state.offsets.get(key);
    const base = actx.state.bases.get(key);

    if (actx.state.owner.get(key) === track.id) actx.state.owner.delete(key);

    if (offsets?.delete(track.id) === true && offsets.size === 0) {
      actx.state.offsets.delete(key);

      if (
        base !== undefined &&
        stored !== undefined &&
        !owned.has(field) &&
        !same(stored[field], base)
      ) {
        clean ??= {};
        clean[field] = base;
      }
    }

    if (!actx.state.owner.has(key) && !actx.state.offsets.has(key)) actx.state.bases.delete(key);
  }

  return clean;
}

/**
 * Takes a track out of the table: it releases the fields it owned, drops its offsets, writes a
 * field whose last additive track just left once more without offsets, when it stands off its
 * base, and counts `Animation` down.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that ends.
 */
function endTrack(actx: AnimCtx, track: Track): void {
  if (track.ended) return;

  track.ended = true;
  actx.state.tracks.delete(track.id);
  if (track.additive) unfileAdditive(actx, track);

  const ecs = actx.deps.world.ecs;
  const clean = releaseFields(actx, track, ecs.get(track.entity, track.component));

  if (clean !== undefined) ecs.set(track.entity, track.component, clean);

  countPlaying(ecs, track.entity, -1);
  if (actx.state.tracks.size <= actx.config.maxTracks) actx.state.overMaxTracks = false;
}

/**
 * Drops one field from a track that lost it to a newer absolute writer. A track that loses every
 * field ends where it stands.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The older owner.
 * @param field - The field the newer track took.
 */
function dropField(actx: AnimCtx, track: Track, field: string): void {
  delete track.to[field];
  if (track.from !== undefined) delete track.from[field];
  if (Object.keys(track.to).length === 0) endTrack(actx, track);
}

/**
 * Books every field of an absolute track and cancels the older owner of each, field by field.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The new absolute track.
 */
function claimFields(actx: AnimCtx, track: Track): void {
  const taken: Array<{ older: Track; field: string }> = [];

  for (const field of Object.keys(track.to)) {
    const key = keyOf(track, field);
    const ownerId = actx.state.owner.get(key);
    const older = ownerId === undefined ? undefined : actx.state.tracks.get(ownerId);

    actx.state.owner.set(key, track.id);
    if (older !== undefined) taken.push({ older, field });
  }

  for (const entry of taken) dropField(actx, entry.older, entry.field);
}

/**
 * Reports once each time the table grows past `maxTracks`, so a leak is visible in development
 * without one line per frame.
 *
 * @param actx - Domain context of the anim plugin.
 */
function warnIfCrowded(actx: AnimCtx): void {
  const tracks = actx.state.tracks.size;

  if (tracks <= actx.config.maxTracks) {
    actx.state.overMaxTracks = false;

    return;
  }

  if (actx.state.overMaxTracks) return;

  actx.state.overMaxTracks = true;
  actx.log.warn("anim:too-many-tracks", { tracks, maxTracks: actx.config.maxTracks });
}

/**
 * Opens a new frame step. A track born from here on is not advanced by this step a second time.
 *
 * @param actx - Domain context of the anim plugin.
 */
export function beginFrame(actx: AnimCtx): void {
  actx.state.frame += 1;
}

/**
 * The empty set of the fields a new track skipped. It lives in its own function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of field names.
 */
function noMaskedFields(): Set<string> {
  return new Set();
}

/**
 * The target of a new track: the fields the caller passed, plus every field a keyframe segment
 * names at the last value a segment gives it, so `claimFields` books the whole walk at once.
 *
 * @param to - The numeric target fields the caller passed.
 * @param segments - The keyframe segments of the track, if any.
 * @returns A new target record the track owns.
 * @example
 * ```ts
 * targetOf({ x: 10 }, [{ at: 0.5, to: { y: 50 } }, { at: 1, to: { x: 10 } }]); // { y: 50, x: 10 }
 * ```
 */
function targetOf(
  to: Record<string, number>,
  segments: readonly TrackSegment[] | undefined
): Record<string, number> {
  const target: Record<string, number> = {};

  for (const segment of segments ?? []) Object.assign(target, segment.to);

  return Object.assign(target, to);
}

/**
 * How many runs a track has after its first one.
 *
 * @param repeat - The `repeat` of the track options.
 * @returns `Infinity` for `"forever"`, the whole number of extra runs, `0` for none.
 * @example
 * ```ts
 * repeatsOf(2.5); // 2
 * ```
 */
function repeatsOf(repeat: number | "forever" | undefined): number {
  if (repeat === "forever") return Number.POSITIVE_INFINITY;

  return repeat !== undefined && repeat > 0 ? Math.floor(repeat) : 0;
}

/**
 * Starts one track. The start values are read when the delay ends, never here. A track with
 * keyframe segments walks them over `ms` and books every field they name; one with `repeat`
 * walks again when a run ends. With reduced motion on, every track but a loop takes 0 ms, its
 * delay and its repeats dropped: it lands on its target at its first frame step. A track started
 * with `reduced: "keep"` keeps its length, its delay and its repeats.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity to animate.
 * @param component - The component to animate.
 * @param to - The numeric target fields.
 * @param options - Duration, easing, delay, the additive flag and the keyframe segments.
 * @param muted - The fields another writer owns, read at every write.
 * @param driven - True when a timeline step advances the track itself.
 * @returns The track, already ended when there was nothing to drive.
 */
export function startTrack(
  actx: AnimCtx,
  entity: Entity,
  component: AnyComponent,
  to: Record<string, number>,
  options: TrackOptions,
  muted: () => ReadonlySet<string>,
  driven = false
): Track {
  const target = targetOf(to, options.segments);
  const repeats = repeatsOf(options.repeat);
  const keep = options.reduced === "keep";
  const instant = actx.state.reducedMotion && !keep && repeats !== Number.POSITIVE_INFINITY;
  const track: Track = {
    id: actx.state.nextId,
    entity,
    component,
    to: target,
    keys: keysOf(entity, component.componentName, target),
    ms: instant ? 0 : options.ms,
    ease: options.ease ?? "out",
    delayMs: instant ? 0 : (options.delayMs ?? 0),
    elapsed: 0,
    from: undefined,
    muted,
    additive: options.additive === true,
    driven,
    bornFrame: actx.state.frame,
    ended: Object.keys(target).length === 0,
    segments: options.segments,
    repeatsLeft: instant ? 0 : repeats,
    held: false,
    masked: noMaskedFields(),
    keep
  };

  actx.state.nextId += 1;
  if (track.ended) return track;

  if (track.additive) fileAdditive(actx, track);
  else claimFields(actx, track);

  actx.state.tracks.set(track.id, track);
  countPlaying(actx.deps.world.ecs, entity, 1);
  actx.deps.time.wake();
  warnIfCrowded(actx);

  return track;
}

/**
 * Tells whether a loop stands on its first key instead of walking: with reduced motion on, unless
 * the author kept it, or when it has no length to walk. It stays in the table either way, so it
 * never ends by itself.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track.
 * @returns True for a loop that holds.
 */
function holdsFirstKey(actx: AnimCtx, track: Track): boolean {
  return (
    track.repeatsLeft === Number.POSITIVE_INFINITY &&
    (track.ms <= 0 || (actx.state.reducedMotion && !track.keep))
  );
}

/**
 * Starts the next runs of a repeating track whose time went past the end of its run. The frame
 * that lands exactly on the end of a run still writes that end; the next run starts after it.
 *
 * @param track - The track.
 * @param past - Milliseconds since the delay ended, as the track counts them.
 * @returns The milliseconds into the run that plays now.
 */
function wrapRuns(track: Track, past: number): number {
  if (track.ms <= 0 || track.repeatsLeft === 0 || past <= track.ms) return past;

  const runs = Math.min(Math.ceil(past / track.ms) - 1, track.repeatsLeft);

  track.repeatsLeft -= runs;
  track.elapsed -= runs * track.ms;

  return past - runs * track.ms;
}

/**
 * Keeps a loop on its first key: the first frame of the hold writes it, the frames after write
 * nothing, and a loop whose component left ends like any track.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The loop that holds.
 */
function holdFirstKey(actx: AnimCtx, track: Track): void {
  track.elapsed = track.delayMs;

  if (!track.held) {
    track.held = true;
    writeFields(actx, track, 0, false);
  } else if (actx.deps.world.ecs.get(track.entity, track.component) === undefined) {
    endTrack(actx, track);
  }
}

/**
 * Advances one track by one delta. A repeating track walks again from its first segment when a
 * run ends and ends after its last run; a loop never ends and, while it holds, stands on its
 * first key with its clock kept at the start, so it walks on from there once released.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to advance.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the track.
 */
export function advanceTrack(actx: AnimCtx, track: Track, deltaMs: number): number {
  if (track.ended) return deltaMs;

  track.elapsed += deltaMs;

  const past = track.elapsed - track.delayMs;

  if (past < 0) return 0;

  if (holdsFirstKey(actx, track)) {
    holdFirstKey(actx, track);

    return 0;
  }

  track.held = false;

  const run = wrapRuns(track, past);
  const fraction = track.ms <= 0 ? 1 : Math.min(run / track.ms, 1);
  const final = fraction >= 1 && (track.repeatsLeft === 0 || track.ms <= 0);

  writeFields(actx, track, fraction, final);
  if (!final) return 0;

  endTrack(actx, track);

  return Math.max(0, run - track.ms);
}

/**
 * Writes the exact target of a track and ends it. Muted fields are left alone here too.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to finish.
 */
export function finishTrack(actx: AnimCtx, track: Track): void {
  if (track.ended) return;

  writeFields(actx, track, 1, true);
  endTrack(actx, track);
}

/**
 * Ends a track where it stands, writing nothing.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to cancel.
 */
export function cancelTrack(actx: AnimCtx, track: Track): void {
  endTrack(actx, track);
}

/**
 * The motion handle of a track: the `MotionHandle` contract of `world`, plus the hand advance the
 * timeline cursor drives a track it just started with.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track behind the handle.
 * @returns The handle.
 */
export function handleOf(actx: AnimCtx, track: Track): StepMotion {
  return {
    finish: (): void => finishTrack(actx, track),
    cancel: (): void => cancelTrack(actx, track),
    active: (): boolean => !track.ended,
    advance: (deltaMs: number): number => advanceTrack(actx, track, deltaMs)
  };
}

/**
 * Advances every track the frame step owns: the additive ones first, so the absolute owner of a
 * field writes the sum of this frame's offsets and not the one of the frame before, then the
 * absolute ones. Each pass keeps the insertion order of the table.
 *
 * A track a timeline step drives is left alone: its own step already handed it the delta, which
 * is what lets the remainder past its end reach the next step of the same frame. A track born
 * inside the running frame step is skipped for the same reason.
 *
 * @param actx - Domain context of the anim plugin.
 * @param deltaMs - Milliseconds of game time of the frame.
 */
export function advanceTracks(actx: AnimCtx, deltaMs: number): void {
  const open = [...actx.state.tracks.values()].filter(
    track => !track.ended && !track.driven && track.bornFrame !== actx.state.frame
  );

  for (const track of open) {
    if (track.additive) advanceTrack(actx, track, deltaMs);
  }

  for (const track of open) {
    if (!track.additive) advanceTrack(actx, track, deltaMs);
  }
}

/**
 * Finishes every track of the table, in table order. With `keepLoops` a loop is left alone: it
 * has no end to finish on, so it stays in the table and stands where it is. The frame step of a
 * fast world asks for that, because nothing would start the loop again: a fast walk of the flow
 * that commits nothing flushes no view, so no view would owe its loop.
 *
 * @param actx - Domain context of the anim plugin.
 * @param keepLoops - True to leave every track that repeats forever running.
 */
export function finishAllTracks(actx: AnimCtx, keepLoops = false): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const track of [...actx.state.tracks.values()]) {
    if (keepLoops && track.repeatsLeft === Number.POSITIVE_INFINITY) continue;

    finishTrack(actx, track);
  }
}

/**
 * Ends every track of one entity, absolute and additive, and removes its `Animation`.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity whose tracks end.
 */
export function cancelTracksOf(actx: AnimCtx, entity: Entity): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const track of [...actx.state.tracks.values()]) {
    if (track.entity === entity) cancelTrack(actx, track);
  }

  actx.deps.world.ecs.remove(entity, Animation);
}
