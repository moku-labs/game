/**
 * @file world/projection — the driver slot: `ViewHandle.tween`, `toRest` and `all` run on the
 * engine `anim` installs with `setDriver`. Without one the instant driver writes every target at
 * once, so a composition without `anim` plays every motion instantly.
 */
import type { AnyComponent, Entity } from "../ecs/types";
import type {
  Ease,
  MotionHandle,
  ProjectionCtx,
  ProjectionState,
  Track,
  TrackOptions,
  TrackSegment,
  TweenDriver
} from "./types";

/**
 * The muted fields of a component nobody mutes and nobody owns: one shared set, so a driver's ask
 * on every frame allocates nothing. Read-only by its type.
 */
const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

/**
 * Creates an empty set of names. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function noFields(): Set<string> {
  return new Set();
}

/**
 * The owned fields of a component type as a set, made the first time the world asks about the
 * type, then kept with the world's projection state.
 *
 * @param state - The projection branch of the plugin state.
 * @param owned - The type's frozen `owned` list.
 * @returns The same set for every ask.
 */
function ownedSetOf(state: ProjectionState, owned: readonly string[]): ReadonlySet<string> {
  const known = state.ownedSets.get(owned);

  if (known !== undefined) return known;

  const made: ReadonlySet<string> = Object.freeze(new Set(owned));

  state.ownedSets.set(owned, made);

  return made;
}

/**
 * Forgets the joined set of one mute's field set, because `mute()` or its release changed it.
 *
 * @param state - The projection branch of the plugin state.
 * @param driven - The field set of one muted component of one entity.
 */
export function forgetJoined(state: ProjectionState, driven: ReadonlySet<string>): void {
  state.joinedMutes.delete(driven);
}

/**
 * The fields a mute holds joined with the fields a type owns, built once and kept with the mute's
 * field set until a mute or its release changes it.
 *
 * @param state - The projection branch of the plugin state.
 * @param driven - The fields a mute holds.
 * @param owned - The owned fields of the component's type.
 * @returns Both, as one set.
 */
function joinedOf(
  state: ProjectionState,
  driven: ReadonlySet<string>,
  owned: ReadonlySet<string>
): ReadonlySet<string> {
  const known = state.joinedMutes.get(driven);

  if (known?.owned === owned) return known.joined;

  const joined = new Set(driven);

  for (const field of owned) joined.add(field);
  state.joinedMutes.set(driven, { owned, joined });

  return joined;
}

/** What a component no loop adds to answers: no offset on any field. */
const NO_OFFSETS: Readonly<Record<string, number>> = Object.freeze({});

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
 * The fields another writer owns on one component of one entity: the fields a `mute()` holds and
 * the `initialOnly` fields of a view's projection (one table, `state.mutes`), and the fields the
 * component type gives to a plugin for good.
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
  const state = pctx.ctx.state.projection;
  const driven = state.mutes.get(entity)?.get(name);
  const owned = pctx.deps.ecs.typeOf(name)?.owned;

  // Per frame per track: a shared or kept set is handed out, none is made.
  if (owned === undefined || owned.length === 0) return driven ?? EMPTY_SET;

  const ownedSet = ownedSetOf(state, owned);

  return driven === undefined || driven.size === 0 ? ownedSet : joinedOf(state, driven, ownedSet);
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
 * The target of a track with every field its segments name: a field the caller left out of `to`
 * takes the last value a segment gave it, so the instant driver ends where `anim` ends.
 *
 * @param to - The numeric target fields the caller passed.
 * @param segments - The keyframe segments of the track, if any.
 * @returns The target the track ends on.
 * @example
 * ```ts
 * withSegmentFields({ x: 100 }, [{ at: 0.5, to: { x: 300, y: 40 } }, { at: 1, to: { x: 100 } }]);
 * // { x: 100, y: 40 }
 * ```
 */
function withSegmentFields(
  to: Record<string, number>,
  segments: readonly TrackSegment[] | undefined
): Record<string, number> {
  if (segments === undefined) return to;

  const filled: Record<string, number> = {};

  for (const segment of segments) Object.assign(filled, segment.to);

  return Object.assign(filled, to);
}

/**
 * Creates the default driver: every track is over before it began. It is what a world plays
 * without `anim` — a unit test of the projection, a headless run, a `logicOnly` composition. A
 * track's `repeat` is ignored: the end pose is written once.
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
      options: TrackOptions,
      muted: () => ReadonlySet<string>
    ): MotionHandle => {
      writeNow(pctx, entity, component, withSegmentFields(to, options.segments), muted);

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
  const record = takeRecord(pctx, entity, component.componentName);
  const handle = driverOf(pctx).track(entity, component, to, options, record.muted);

  fileTrack(pctx, record, handle, options);

  return handle;
}

/**
 * Starts the track `toRest` plays without a `reduced` rule or a label: to the numeric fields of a rest value, with
 * the target and the options the record keeps for it, so a rest move of a kept record builds nothing (F244 В). The
 * driver reads them during the call; the record keeps them for the track until it ended.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to bring home.
 * @param component - The component to bring home.
 * @param rest - The rest value; its numeric fields are the target.
 * @param timing - The length, the easing and the delay of the track.
 * @returns The motion handle of the track.
 */
export function startRestTrack(
  pctx: ProjectionCtx,
  entity: Entity,
  component: AnyComponent,
  rest: Readonly<Record<string, unknown>>,
  timing: RestTiming
): MotionHandle {
  const record = takeRecord(pctx, entity, component.componentName);
  const options = record.options;

  options.ms = timing.ms;
  options.ease = timing.ease;
  options.delayMs = timing.delayMs;
  numericInto(record, rest);

  const handle = driverOf(pctx).track(entity, component, record.to, options, record.muted);

  fileTrack(pctx, record, handle, options);

  return handle;
}

/** What a rest track of `toRest` is timed by. */
export type RestTiming = { ms: number; ease: Ease; delayMs: number };

/**
 * A track record of the projection with what its start hands the driver: the `muted` reader of its entity and
 * component, made once per record, and the target and options of a rest track. A record the sweep drops once its
 * track ended is kept for the next start.
 */
type KeptTrack = Track & {
  /** The fields another writer owns on the record's entity and component, read by the driver at every write. */
  readonly muted: () => ReadonlySet<string>;
  /** The numeric target of a rest track, written in place while its fields stay the same. */
  to: Record<string, number>;
  /** The fields of `to`, in order. */
  names: string[];
  /** The options of a rest track. */
  readonly options: { ms: number; ease: Ease; delayMs: number; additive: boolean };
};

/**
 * Tells whether a filed track is a record `takeRecord` made, with its own `muted` reader: only such a record goes back
 * to the free list (`state.freeTracks`), never a track filed by hand.
 *
 * @param track - A track of the projection's table.
 * @returns True for a kept record.
 */
function isKept(track: Track): track is KeptTrack {
  return "muted" in track;
}

/**
 * The driver the next track starts on: the installed one, else the instant one.
 *
 * @param pctx - Domain context of the projection module.
 * @returns The driver.
 */
function driverOf(pctx: ProjectionCtx): TweenDriver {
  return pctx.ctx.state.projection.driver ?? createInstantDriver(pctx);
}

/**
 * A track record for a start on one component of one entity: a free one, else a new one with its own `muted` reader.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity the track animates.
 * @param component - Component name.
 * @returns The record, its entity and component written.
 */
function takeRecord(pctx: ProjectionCtx, entity: Entity, component: string): KeptTrack {
  const free = pctx.ctx.state.projection.freeTracks.pop();
  const record = free !== undefined && isKept(free) ? free : newRecord(pctx);

  record.entity = entity;
  record.component = component;

  return record;
}

/**
 * A new track record; its `muted` reads the entity and component the record holds at the call.
 *
 * @param pctx - Domain context of the projection module.
 * @returns The record.
 */
function newRecord(pctx: ProjectionCtx): KeptTrack {
  const record: KeptTrack = {
    entity: 0 as Entity,
    component: "",
    handle: INERT,
    additive: false,
    forever: false,
    label: undefined,
    muted: (): ReadonlySet<string> => mutedFields(pctx, record.entity, record.component),
    to: {},
    names: [],
    options: { ms: 0, ease: "out", delayMs: 0, additive: false }
  };

  return record;
}

/**
 * Files a started track with the projection, so it knows which components are driven; a track that is over at once
 * gives its record back.
 *
 * @param pctx - Domain context of the projection module.
 * @param record - The track's record.
 * @param handle - The handle the driver gave.
 * @param options - The options of the start.
 */
function fileTrack(
  pctx: ProjectionCtx,
  record: KeptTrack,
  handle: MotionHandle,
  options: TrackOptions
): void {
  const state = pctx.ctx.state.projection;

  if (!handle.active()) {
    releaseRecord(state, record);

    return;
  }

  record.handle = handle;
  record.additive = options.additive === true;
  record.forever = options.repeat === "forever";
  record.label = options.label;
  state.tracks.push(record);
}

/**
 * Keeps a record whose track ended for the next start, and lets its handle go.
 *
 * @param state - The projection branch of the plugin state.
 * @param record - A record the track table dropped.
 */
function releaseRecord(state: ProjectionState, record: Track): void {
  if (!isKept(record)) return;

  record.handle = INERT;
  state.freeTracks.push(record);
}

/**
 * Writes the numeric fields of a rest value into a record's target, in place while they are the fields it holds, in
 * their order; else the record gets a new target.
 *
 * @param record - The record of a rest track.
 * @param rest - The rest value.
 */
function numericInto(record: KeptTrack, rest: Readonly<Record<string, unknown>>): void {
  const { names, to } = record;
  let slot = 0;
  let same = true;

  // Per rest track: `for…in` over the rest value's own fields, no key array.
  for (const field in rest) {
    const value = rest[field];

    if (typeof value !== "number") continue;

    if (names[slot] === field) to[field] = value;
    else same = false;

    slot++;
  }

  if (same && slot === names.length) return;

  const fresh: Record<string, number> = {};

  names.length = 0;

  for (const field in rest) {
    const value = rest[field];

    if (typeof value !== "number") continue;

    fresh[field] = value;
    names.push(field);
  }

  record.to = fresh;
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
  keepTracks(state, entity);
}

/**
 * Compacts the track table in place: the tracks that still run stay, in order, and the tracks of
 * `entity` go, their records kept for the next start. The tail is popped, never cut with `length`:
 * cutting releases the array's store, and the next track would allocate it again.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity whose tracks go; none when left out.
 */
function keepTracks(state: ProjectionState, entity?: Entity): void {
  const tracks = state.tracks;
  let kept = 0;

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];

    if (track === undefined) continue;

    if (track.entity === entity || !track.handle.active()) {
      releaseRecord(state, track);
      continue;
    }

    tracks[kept] = track;
    kept += 1;
  }

  while (tracks.length > kept) tracks.pop();
}

/**
 * Forgets the tracks that ended, so `looseComponents` only ever sees what still runs.
 *
 * @param pctx - Domain context of the projection module.
 */
export function forgetEndedTracks(pctx: ProjectionCtx): void {
  // Per frame: compacted in place, no new table.
  keepTracks(pctx.ctx.state.projection);
}

/**
 * The component names a running track drives on one entity. An additive track drives none: the
 * loop of a view adds an offset to the rest pose and owns no component, so a settle may bring
 * the component home under it.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to ask about.
 * @returns The names of the driven components.
 */
export function drivenComponents(pctx: ProjectionCtx, entity: Entity): Set<string> {
  forgetEndedTracks(pctx);

  const driven = noFields();

  for (const track of pctx.ctx.state.projection.tracks) {
    if (track.entity === entity && !track.additive) driven.add(track.component);
  }

  return driven;
}

/**
 * What the additive tracks of the installed driver add to one component of one entity right now:
 * the offset of a loop. A driver that does not report it, and a world without a driver, answer
 * no offset.
 *
 * @param pctx - Domain context of the projection module.
 * @param entity - The entity to ask about.
 * @param component - The component to ask about.
 * @returns Field name to what is added to it, empty for a component no loop adds to.
 */
export function loopOffsets(
  pctx: ProjectionCtx,
  entity: Entity,
  component: AnyComponent
): Readonly<Record<string, number>> {
  return pctx.ctx.state.projection.driver?.offsetsOf?.(entity, component) ?? NO_OFFSETS;
}

/**
 * The components a running track drives on one entity, in start order, each name once. It only
 * reads: an ended track is skipped, not forgotten.
 *
 * @param tracks - The tracks the projection started.
 * @param entity - The entity to ask about.
 * @returns A new array of component names.
 */
export function runningComponents(tracks: readonly Track[], entity: Entity): string[] {
  const names: string[] = [];

  for (const track of tracks) {
    if (track.entity !== entity || names.includes(track.component)) continue;
    if (track.handle.active()) names.push(track.component);
  }

  return names;
}

/**
 * The labels of the running tracks on one entity, in track order, each once. A track without a
 * label adds none. It only reads: an ended track is skipped, not forgotten.
 *
 * @param tracks - The tracks the projection started.
 * @param entity - The entity to ask about.
 * @returns A new array of labels.
 */
export function runningLabels(tracks: readonly Track[], entity: Entity): string[] {
  const labels: string[] = [];

  for (const track of tracks) {
    if (track.entity !== entity) continue;
    if (track.label === undefined || labels.includes(track.label)) continue;

    if (track.handle.active()) labels.push(track.label);
  }

  return labels;
}
