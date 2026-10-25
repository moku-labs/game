/**
 * @file anim/tween — the one track table: starting a track, the retarget policy per field, the
 * offsets accumulator of the additive tracks, the per-frame advance with its repeats, reduced
 * motion and the two ways out. Deterministic: the only clock is the `delta` a caller hands in.
 */
import { NineSlice, Shape, Sprite, Transform } from "../../renderer/components";
import type { AnyComponent } from "../../world/ecs/types";
import type { Entity, TrackOptions, TrackSegment } from "../../world/types";
import { Animation, countPlaying } from "../components";
import { dropEnded } from "../dense";
import type { AnimCtx } from "../types";
import { baseOr, cellValue, setBase, setOffset, sumOffsets } from "./cells";
import { easeCell } from "./easing";
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
 */
function beginTrack(actx: AnimCtx, track: Track, stored: Readonly<Record<string, unknown>>): void {
  if (track.begun) return;

  track.begun = true;

  for (let slot = 0; slot < track.names.length; slot++) {
    const field = track.names[slot];
    const key = track.slotKeys[slot];

    if (track.live[slot] === 0 || field === undefined || key === undefined) continue;

    const base = actx.state.bases.get(key);
    const current = stored[field];
    const read = typeof current === "number" ? current : (track.targets[slot] ?? 0);
    const value = base === undefined ? read : cellValue(base);

    track.starts[slot] = value;
    if (base === undefined) setBase(actx, key, value);
  }
}

/**
 * Walks the keyframe segments of a track to its normalised time `clock[1]`, for one slot. Each
 * segment eases, with its own curve or the track's, from where the segment before left the
 * field; a segment that does not name the field holds it, and past the last segment the field
 * holds too. An additive walk starts at no offset, an absolute one at the start value. The value
 * lands in `values[slot]`.
 *
 * @param track - The track, with segments.
 * @param segments - Its segments, in order.
 * @param slot - The slot.
 */
function walkSlot(track: Track, segments: readonly TrackSegment[], slot: number): void {
  const values = track.values;
  const field = track.names[slot] ?? "";
  const fraction = track.clock[1] ?? 0;
  // An additive walk names offsets and starts at none; an absolute one starts at the start value.
  let from = track.additive ? 0 : (track.starts[slot] ?? 0);
  let fromAt = 0;

  // per frame: an indexed loop, no iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks by index
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];

    if (segment === undefined) continue;

    const target = segment.to[field] ?? from;

    if (fraction <= segment.at) {
      const span = segment.at - fromAt;

      values[slot] = span <= 0 ? 1 : (fraction - fromAt) / span;

      // On the key itself the value is the key's, exactly: no float drift from `from + Δ × 1`.
      if ((values[slot] ?? 0) >= 1) {
        values[slot] = target;

        return;
      }

      easeCell(segment.ease ?? track.ease, values, slot);
      values[slot] = from + (target - from) * (values[slot] ?? 0);

      return;
    }

    from = target;
    fromAt = segment.at;
  }

  values[slot] = from;
}

/**
 * What one slot of a track contributes at its write: eased straight from the start to the target,
 * or along the keyframe segments, at the normalised time `clock[1]`; the exact target on the last
 * frame. An absolute track contributes the value, an additive one the offset over its origin: 0
 * for a keyframe walk of offsets, the start value for a straight track. The result lands in
 * `values[slot]`: the numbers of a frame live in the track's cells, so no number crosses a call
 * boxed.
 *
 * @param track - The track that writes.
 * @param slot - The slot.
 * @param final - True on the last frame, which reaches the exact target.
 */
function slotValue(track: Track, slot: number, final: boolean): void {
  const values = track.values;
  const segments = track.segments;
  const walksOffsets = track.additive && segments !== undefined;

  if (final) {
    values[slot] = track.targets[slot] ?? 0;
  } else if (segments === undefined) {
    const start = track.starts[slot] ?? 0;

    values[slot] = track.clock[1] ?? 0;
    easeCell(track.ease, values, slot);
    values[slot] = start + ((track.targets[slot] ?? 0) - start) * (values[slot] ?? 0);
  } else {
    walkSlot(track, segments, slot);
  }

  if (track.additive && !walksOffsets)
    values[slot] = (values[slot] ?? 0) - (track.starts[slot] ?? 0);
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
 * @param slot - The slot of the field; `values[slot]` holds what the track adds to it now.
 * @param stored - The stored component value, before this write. Read only on a give-back.
 */
function addOffset(
  actx: AnimCtx,
  track: Track,
  slot: number,
  stored: Readonly<Record<string, unknown>>
): void {
  const key = track.slotKeys[slot] ?? "";
  const field = track.names[slot] ?? "";
  const written = baseOr(actx, key, 0) + sumOffsets(actx, key);

  setOffset(actx, key, track.id, track.values[slot] ?? 0);

  if (!track.masked.delete(field)) return;

  const left = stored[field];

  if (typeof left !== "number" || Math.abs(left - written) <= UNTOUCHED) return;

  setBase(actx, key, left - sumOffsets(actx, key));
}

/**
 * Books what one slot of a track contributes at this write, into the base of the field for an
 * absolute track or its offset for an additive one, then leaves in `values[slot]` what the field
 * reads now: the base plus every offset.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that writes.
 * @param slot - The slot; `values[slot]` holds its contribution (`slotValue`).
 * @param stored - The stored component value, before this write.
 */
function bookSlot(
  actx: AnimCtx,
  track: Track,
  slot: number,
  stored: Readonly<Record<string, unknown>>
): void {
  const key = track.slotKeys[slot] ?? "";

  if (track.additive) addOffset(actx, track, slot, stored);
  else setBase(actx, key, track.values[slot] ?? 0);

  track.values[slot] = baseOr(actx, key, track.starts[slot] ?? 0) + sumOffsets(actx, key);
}

/**
 * Tells whether the value a track writes now moved off the one it last left in the field. An
 * unknown last value (`NaN`) never counts as moved: the field is read then.
 *
 * @param last - What the track last left in the field, `NaN` when unknown.
 * @param next - What it would write now.
 * @returns True when the two are known and differ.
 * @example
 * ```ts
 * movedOff(0.5, 0.75); // true
 * movedOff(Number.NaN, 0.75); // false
 * ```
 */
function movedOff(last: number, next: number): boolean {
  return !Number.isNaN(last) && !Number.isNaN(next) && last !== next;
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
 * A frame that moves every field writes the track's own patch, filled in place. A frame that
 * leaves a field alone writes the track's patch of the fields it moves, kept for the next such
 * frame and built again only when the moved fields change, so no other field is written.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to write, its normalised time in `clock[1]`.
 * @param final - True on the last frame, which writes the exact target.
 */
function writeFields(actx: AnimCtx, track: Track, final: boolean): void {
  const ecs = actx.deps.world.ecs;
  const stored = ecs.get(track.entity, track.component);

  if (stored === undefined) {
    endTrack(actx, track);

    return;
  }

  beginTrack(actx, track, stored);

  const owned = track.muted();
  // per frame: the slots of the track, its value cells and its own patch, all made when it
  // started; the numbers pass between the steps in `values`, so nothing new is made.
  const { names, live, moved, values, seen } = track;
  let fields = 0;
  let count = 0;

  // eslint-disable-next-line unicorn/no-for-loop -- the slot indexes four arrays of the track
  for (let slot = 0; slot < names.length; slot++) {
    const field = names[slot];

    moved[slot] = 0;
    if (live[slot] === 0 || field === undefined) continue;

    fields++;
    if (skipsOwned(track, owned, field)) {
      // Another writer holds the field: what it holds is unknown again until it is read.
      seen[slot] = Number.NaN;
      continue;
    }

    slotValue(track, slot, final);
    bookSlot(actx, track, slot, stored);

    const next = values[slot] ?? 0;

    // per frame: a value that moved off the one this track last left in the field is written
    // without reading the field, which would box a number; a value that stands still is checked
    // against the field, so a writer that moved it in between is undone and a still field is not.
    if (!movedOff(seen[slot] ?? Number.NaN, next) && same(stored[field], next)) {
      seen[slot] = next;
      continue;
    }

    seen[slot] = next;
    moved[slot] = 1;
    count++;
  }

  if (count === 0) return;

  const written = count === fields ? track.patch : partialPatch(track);

  fillPatch(track, written);
  ecs.set(track.entity, track.component, written);
}

/**
 * Puts the values of the moved slots into a patch of the track: each moved field gets what the
 * frame left in `values` for it.
 *
 * @param track - The track that writes.
 * @param written - Its full patch, or its patch of the moved fields.
 */
function fillPatch(track: Track, written: Record<string, unknown>): void {
  const { names, moved, values } = track;

  // per frame: one indexed pass; a double written into the patch is the only box (budgets.ts).
  // eslint-disable-next-line unicorn/no-for-loop -- the slot indexes three arrays of the track
  for (let slot = 0; slot < names.length; slot++) {
    const field = names[slot];

    if (moved[slot] === 1 && field !== undefined) written[field] = values[slot] ?? 0;
  }
}

/**
 * The patch of a frame that moved only some of the fields of a track: the one the track keeps,
 * when the frame moved the same fields as the frame it was built for, otherwise a new one.
 *
 * @param track - The track that writes, its `moved` flags set by this frame.
 * @returns The patch of exactly the moved fields; their values are filled after.
 */
function partialPatch(track: Track): Record<string, unknown> {
  const { moved, partialMoved, partial } = track;

  if (partial === undefined) return keepPartial(track);

  // per frame: the same fields as last time keep the patch, so a hand that holds a field costs no object.
  // eslint-disable-next-line unicorn/no-for-loop -- the slot indexes two arrays of the track
  for (let slot = 0; slot < moved.length; slot++) {
    if (moved[slot] !== partialMoved[slot]) return keepPartial(track);
  }

  return partial;
}

/**
 * Builds the patch of the fields the frame moved and keeps it on the track, with the `moved`
 * flags it was built for. Runs only when the moved fields change.
 *
 * @param track - The track that writes.
 * @returns The new patch, its values still to fill.
 */
function keepPartial(track: Track): Record<string, unknown> {
  const built: Record<string, unknown> = {};

  for (let slot = 0; slot < track.names.length; slot++) {
    const field = track.names[slot];

    if (track.moved[slot] === 1 && field !== undefined) built[field] = 0;
  }

  track.partialMoved.set(track.moved);
  track.partial = built;

  return built;
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
        !same(stored[field], cellValue(base))
      ) {
        clean ??= {};
        clean[field] = cellValue(base);
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
  track.live[track.names.indexOf(field)] = 0;
  // The patch keeps exactly the fields of `to`: a field the newer track took is never written back.
  track.patch = { ...track.to };
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
 * Tells whether a field sizes a built-in visual: a loop of it may bring the view onto the screen. Pure.
 *
 * @param field - A field of a Sprite, a NineSlice or a Shape.
 * @returns True for `w`, `h`, `width` and `height`.
 * @example
 * ```ts
 * isSizeField("width"); // true
 * ```
 */
function isSizeField(field: string): boolean {
  return field === "w" || field === "h" || field === "width" || field === "height";
}

/**
 * What a track writes that could show its view again (spec 26 R1.7.4): `"alpha"`, `"place"` (any field of
 * `Transform`, a size of a built-in visual), both, or nothing. A component anim cannot read (a game's own, a filter's
 * values, a text's style) may show the view any way: `"both"`. Pure.
 *
 * @param component - The component the track writes.
 * @param fields - The fields it writes.
 * @returns What it reveals, or `undefined` for a write that cannot show the view (a tint, a fill colour).
 * @example
 * ```ts
 * revealsOf(Transform, { rotation: 0.5 }); // "place"
 * ```
 */
function revealsOf(
  component: AnyComponent,
  fields: Readonly<Record<string, number>>
): "alpha" | "place" | "both" | undefined {
  const visual = component === Sprite || component === NineSlice || component === Shape;

  if (component !== Transform && !visual) return "both";

  let alpha = false;
  let place = false;

  for (const field in fields) {
    if (field === "alpha") alpha = true;
    else if (component === Transform || isSizeField(field)) place = true;
  }

  if (alpha && place) return "both";
  if (alpha) return "alpha";

  return place ? "place" : undefined;
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
 * with `reduced: "keep"` keeps its length, its delay and its repeats. A timeline's loop under
 * reduced motion does not play at all: it is born ended, writes nothing, and its step goes on.
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
  const cut = actx.state.reducedMotion && !keep;
  const instant = cut && repeats !== Number.POSITIVE_INFINITY;
  const keys = keysOf(entity, component.componentName, target);
  const names = Object.keys(target);
  // A view's loop stands on its first key under reduced motion; a timeline's would hold its play
  // open on a still pose for ever, so it is not started.
  const bornEnded = names.length === 0 || (cut && driven && repeats === Number.POSITIVE_INFINITY);
  const track: Track = {
    id: actx.state.nextId,
    entity,
    component,
    to: target,
    keys,
    ms: instant ? 0 : options.ms,
    ease: options.ease ?? "out",
    delayMs: instant ? 0 : (options.delayMs ?? 0),
    clock: new Float64Array(2),
    begun: false,
    names,
    slotKeys: names.map(field => keys[field] ?? ""),
    targets: Float64Array.from(names, field => target[field] ?? 0),
    starts: new Float64Array(names.length),
    live: new Uint8Array(names.length).fill(1),
    moved: new Uint8Array(names.length),
    values: new Float64Array(names.length),
    seen: new Float64Array(names.length).fill(Number.NaN),
    muted,
    additive: options.additive === true,
    driven,
    bornFrame: actx.state.frame,
    ended: bornEnded,
    segments: options.segments,
    repeatsLeft: instant ? 0 : repeats,
    held: false,
    masked: noMaskedFields(),
    keep,
    reveals: revealsOf(component, target),
    patch: { ...target },
    partial: undefined,
    partialMoved: new Uint8Array(names.length)
  };

  actx.state.nextId += 1;
  if (track.ended) return track;

  if (track.additive) fileAdditive(actx, track);
  else claimFields(actx, track);

  actx.state.tracks.set(track.id, track);
  actx.state.trackList.push(track);
  countPlaying(actx.deps.world.ecs, entity, 1);
  actx.deps.time.wake();
  warnIfCrowded(actx);
  if (landsAtStart(track, options)) writeFields(actx, track, true);

  return track;
}

/**
 * Tells whether a track writes its target as it starts: an absolute one of 0 ms with no delay,
 * no repeat and no keys, started so by its caller (not cut by reduced motion). A rest pose a
 * caller sets in phase `layout` so lands with the fields written beside it in that frame (F47);
 * the next frame step ends it, where its `Animation` count lands too.
 *
 * @param track - The track that starts.
 * @param options - What its caller asked for.
 * @returns True when it lands now.
 */
function landsAtStart(track: Track, options: TrackOptions): boolean {
  return (
    options.ms === 0 &&
    track.delayMs === 0 &&
    !track.additive &&
    !track.driven &&
    track.repeatsLeft === 0 &&
    track.segments === undefined
  );
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
 * It reads the milliseconds since the delay ended off `clock[0]` and leaves the milliseconds into
 * the run that plays now in `clock[1]`, so no number crosses the call boxed.
 *
 * @param track - The track.
 */
function wrapRuns(track: Track): void {
  const clock = track.clock;
  const past = (clock[0] ?? 0) - track.delayMs;

  clock[1] = past;
  if (track.ms <= 0 || track.repeatsLeft === 0 || past <= track.ms) return;

  const runs = Math.min(Math.ceil(past / track.ms) - 1, track.repeatsLeft);

  track.repeatsLeft -= runs;
  clock[0] = (clock[0] ?? 0) - runs * track.ms;
  clock[1] = past - runs * track.ms;
}

/**
 * Keeps a loop on its first key: the first frame of the hold writes it, the frames after write
 * nothing, and a loop whose component left ends like any track.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The loop that holds.
 */
function holdFirstKey(actx: AnimCtx, track: Track): void {
  track.clock[0] = track.delayMs;

  if (!track.held) {
    track.held = true;
    track.clock[1] = 0;
    writeFields(actx, track, false);
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

  const clock = track.clock;

  // per frame: the clock is a cell, written in place.
  clock[0] = (clock[0] ?? 0) + deltaMs;

  if ((clock[0] ?? 0) - track.delayMs < 0) return 0;

  if (holdsFirstKey(actx, track)) {
    holdFirstKey(actx, track);

    return 0;
  }

  track.held = false;

  wrapRuns(track);

  const run = clock[1] ?? 0;
  const fraction = track.ms <= 0 ? 1 : Math.min(run / track.ms, 1);
  const final = fraction >= 1 && (track.repeatsLeft === 0 || track.ms <= 0);

  if (isHeldLoop(actx, track, final)) return 0;

  clock[1] = fraction;
  writeFields(actx, track, final);
  if (!final) return 0;

  endTrack(actx, track);

  return Math.max(0, run - track.ms);
}

/**
 * Tells whether an endless loop writes nothing this frame because the player cannot see it.
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track that advances.
 * @param final - Whether this step lands the track.
 * @returns True when the loop is held.
 */
function isHeldLoop(actx: AnimCtx, track: Track, final: boolean): boolean {
  // An endless loop of a view the player cannot see writes nothing; its clock ran on, so it writes the phase of the
  // time when it is shown again (spec 22 O9, spec 26 R1.7). A timeline's endless track asks too (F76); a finite one,
  // which a node may wait for, never does. Bases and offsets stay.
  return (
    !final &&
    track.repeatsLeft === Number.POSITIVE_INFINITY &&
    actx.state.loopsHeld?.(track.entity, track.reveals) === true
  );
}

/**
 * Writes the exact target of a track and ends it. Muted fields are left alone here too. A
 * timeline's loop has no end to land on: it lands on its first key, the pose its walk starts
 * from, which is where a cut or a fast walk leaves it (F75).
 *
 * @param actx - Domain context of the anim plugin.
 * @param track - The track to finish.
 */
export function finishTrack(actx: AnimCtx, track: Track): void {
  if (track.ended) return;

  const final = !track.driven || track.repeatsLeft !== Number.POSITIVE_INFINITY;

  track.clock[1] = final ? 1 : 0;
  writeFields(actx, track, final);
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
 * inside the running frame step is skipped for the same reason. The tracks that ended leave the
 * dense list after both passes.
 *
 * @param actx - Domain context of the anim plugin.
 * @param deltaMs - Milliseconds of game time of the frame.
 */
export function advanceTracks(actx: AnimCtx, deltaMs: number): void {
  const list = actx.state.trackList;
  // A track started during the walk is past `count`; it was born in this step and waits anyway.
  const count = list.length;
  const frame = actx.state.frame;

  // per frame: two indexed passes over the dense list, no snapshot array and no filter closure.
  for (let index = 0; index < count; index++) {
    const track = list[index];

    if (track?.additive && opens(track, frame)) {
      advanceTrack(actx, track, deltaMs);
    }
  }

  for (let index = 0; index < count; index++) {
    const track = list[index];

    if (track !== undefined && !track.additive && opens(track, frame)) {
      advanceTrack(actx, track, deltaMs);
    }
  }

  dropEnded(list);
}

/**
 * Tells whether the frame step advances a track: it still runs, no timeline step drives it and it
 * was not born in this step.
 *
 * @param track - A track of the dense list.
 * @param frame - The number of the running frame step.
 * @returns True when the frame step hands it the delta.
 */
function opens(track: Track, frame: number): boolean {
  return !track.ended && !track.driven && track.bornFrame !== frame;
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
  const list = actx.state.trackList;
  // A fast world calls this every frame: an indexed walk of the tracks there were, no snapshot.
  const count = list.length;

  for (let index = 0; index < count; index++) {
    const track = list[index];

    if (track === undefined || (keepLoops && track.repeatsLeft === Number.POSITIVE_INFINITY)) {
      continue;
    }

    finishTrack(actx, track);
  }

  dropEnded(list);
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
