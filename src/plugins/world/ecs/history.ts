/**
 * @file world/ecs — the frame history of a dev build: one shadow copy of the world as JSON and a
 * ring with the change records of the last frames, so `diff` can say what changed between two
 * frames. Records cost memory only when something changes: 120 full snapshots of a big board
 * would not fit a phone. A slot keeps its record objects and their copied values when the ring
 * comes round to it again, and a copy is written into the object it replaces, so a frame that
 * changes what an earlier frame changed allocates nothing (F70).
 *
 * Only `recordFrame` starts a history, and `lifecycle.ts` calls it behind the inline dev guard,
 * so a production bundle drops the recorder and `history` stays `undefined`. The other writers
 * here do nothing without a history.
 */
import type { Json } from "../../model/types";
import type { WorldCtx } from "../types";
import { componentsOf, jsonOf } from "./snapshot";
import type {
  ComponentChange,
  EcsState,
  Entity,
  EntityDiff,
  FrameDiff,
  History,
  HistorySlot,
  MarkCount,
  Owner,
  ShadowEntry
} from "./types";

/** How many frames the history keeps: 2 s at 60 fps, so a glitch seen by eye is still in it. */
export const HISTORY_FRAMES = 120;

/** Rows a frame a component must be marked, on average over a window, to be judged wasteful. */
const MARKED_ROWS = 32;

/** The share of changed rows at or under which marked rows count as wasted: one in twenty. */
const CHANGED_SHARE = 1 / 20;

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "the component was not there".
const absent: Json = null;

/** One entity folded over a window: its owner, its first and last values, and how it lived. */
type Folded = {
  id: Entity;
  owner: Owner;
  pairs: Map<string, ComponentChange>;
  spawned: boolean;
  despawned: boolean;
};

/**
 * Creates an empty ring, one empty slot per kept frame.
 *
 * @returns `HISTORY_FRAMES` empty slots.
 */
function emptySlots(): Array<HistorySlot | undefined> {
  return Array.from({ length: HISTORY_FRAMES });
}

/**
 * Creates an empty shadow. It lives in its own non-exported function because lint rule L5 refuses
 * a collection built inside an exported declaration.
 *
 * @returns An empty table of entity to recorded JSON.
 */
function emptyShadow(): Map<Entity, ShadowEntry> {
  return new Map();
}

/**
 * Creates an empty component table, for the same L5 reason.
 *
 * @returns An empty table of component name to JSON.
 */
function emptyComponents(): Map<string, Json> {
  return new Map();
}

/**
 * Creates an empty table of mark counts, for the same L5 reason.
 *
 * @returns An empty table of component name to its counts.
 */
function emptyMarks(): Map<string, MarkCount> {
  return new Map();
}

/**
 * Creates an empty set of component names, for the same L5 reason.
 *
 * @returns An empty set.
 */
function emptyNames(): Set<string> {
  return new Set();
}

/**
 * Creates the empty table a fold fills, for the same L5 reason.
 *
 * @returns An empty table of entity to folded entity.
 */
function emptyFold(): Map<Entity, Folded> {
  return new Map();
}

/**
 * Compares two JSON values structurally, the rule the projection's component diff uses. Index and
 * `for…in` loops: it runs for every marked row of every frame of a dev build, and allocates nothing.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns True when both hold the same data.
 * @example
 * ```ts
 * sameJson({ x: 1, tags: ["a"] }, { x: 1, tags: ["a"] }); // true
 * ```
 */
function sameJson(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (left === null || right === null) return false;

  if (Array.isArray(left)) return Array.isArray(right) && sameArray(left, right);
  if (Array.isArray(right)) return false;

  return sameObject(left, right);
}

/**
 * Compares two JSON arrays entry by entry.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns True when both have the same length and equal entries.
 * @example
 * ```ts
 * sameArray([1, [2]], [1, [2]]); // true
 * ```
 */
function sameArray(left: Json[], right: Json[]): boolean {
  const count = left.length;

  if (count !== right.length) return false;

  for (let index = 0; index < count; index += 1) {
    const mine = left[index];
    const other = right[index];

    if (mine === undefined || other === undefined || !sameJson(mine, other)) return false;
  }

  return true;
}

/**
 * Compares two JSON objects: every key of the left one equal on the right, and no key on the right
 * that the left one lacks.
 *
 * @param left - First object.
 * @param right - Second object.
 * @returns True when both hold the same keys with equal values.
 * @example
 * ```ts
 * sameObject({ a: 1 }, { a: 1, b: 2 }); // false
 * ```
 */
function sameObject(left: { [key: string]: Json }, right: { [key: string]: Json }): boolean {
  for (const key in left) {
    const mine = left[key];
    const other = right[key];

    if (mine === undefined || other === undefined || !sameJson(mine, other)) return false;
  }

  for (const key in right) {
    if (!Object.hasOwn(left, key)) return false;
  }

  return true;
}

/**
 * Copies a JSON value into the object or array it replaces, when that one has the same kind and,
 * for an array, the same length; otherwise into a new one. A primitive is its own copy.
 *
 * @param source - The value to copy.
 * @param into - The earlier copy it replaces, if there is one.
 * @returns The copy: `into` itself when it could take the value.
 * @example
 * ```ts
 * copyJson({ x: 2 }, { x: 1 }); // { x: 2 }: the second object, written in place
 * ```
 */
function copyJson(source: Json, into?: Json): Json {
  if (typeof source !== "object" || source === null) return source;

  if (Array.isArray(source)) {
    const count = source.length;
    const target: Json[] =
      Array.isArray(into) && into.length === count
        ? into
        : Array.from({ length: count }, () => absent);

    for (let index = 0; index < count; index += 1) {
      target[index] = copyJson(source[index] ?? absent, target[index]);
    }

    return target;
  }

  const target: { [key: string]: Json } =
    typeof into === "object" && into !== null && !Array.isArray(into) ? into : {};

  for (const key in source) target[key] = copyJson(source[key] ?? absent, target[key]);

  for (const key in target) {
    if (!Object.hasOwn(source, key)) delete target[key];
  }

  return target;
}

/**
 * Writes one record into the next record object of a slot: the spare one left by the frame that
 * held the slot before, or a new one. `from` and `to` are copied into the values that record held.
 *
 * @param slot - The slot of this frame.
 * @param id - The entity.
 * @param owner - Its owner.
 * @param component - The component name.
 * @param from - The value before, `absent` for none.
 * @param to - The value after, `absent` for none.
 */
function writeChange(
  slot: HistorySlot,
  id: Entity,
  owner: Owner,
  component: string,
  from: Json,
  to: Json
): void {
  const spare = slot.changes[slot.count];

  slot.count += 1;

  if (spare === undefined) {
    slot.changes.push({ id, owner, component, from: copyJson(from), to: copyJson(to) });

    return;
  }

  spare.id = id;
  spare.owner = owner;
  spare.component = component;
  spare.from = copyJson(from, spare.from);
  spare.to = copyJson(to, spare.to);
}

/**
 * The slot of one frame, emptied for it when the ring still holds an older frame at its index:
 * its record objects stay, as spares.
 *
 * @param history - The frame history.
 * @param frame - The frame number.
 * @returns The slot of that frame.
 */
function slotFor(history: History, frame: number): HistorySlot {
  const index = frame % HISTORY_FRAMES;
  const known = history.slots[index];

  if (known?.frame === frame) return known;

  if (known !== undefined) {
    known.frame = frame;
    known.count = 0;
    if (known.spawned.length > 0) known.spawned.length = 0;
    if (known.despawned.length > 0) known.despawned.length = 0;

    return known;
  }

  const fresh: HistorySlot = { frame, changes: [], count: 0, spawned: [], despawned: [] };

  history.slots[index] = fresh;

  return fresh;
}

/**
 * The frame a despawn or a removal belongs to: the current one, or the next when the recorder
 * already closed the current one. A write after `signals` is part of the world at the end of the
 * next frame, as a `set` there is.
 *
 * @param ctx - Domain context of the world plugin.
 * @param history - The frame history.
 * @returns The frame number of the open slot.
 */
function openFrame(ctx: WorldCtx, history: History): number {
  const frame = ctx.deps.time.snapshot().frame;

  return frame === history.newest ? frame + 1 : frame;
}

/**
 * The JSON components of one entity, copied, with the filter of `snapshot()`.
 *
 * @param state - ecs module state.
 * @param entity - The entity to read.
 * @returns Component name to a copy of its value.
 */
function copiedComponents(state: EcsState, entity: Entity): Map<string, Json> {
  const copies = emptyComponents();

  for (const [name, value] of Object.entries(componentsOf(state, entity).components)) {
    copies.set(name, copyJson(value));
  }

  return copies;
}

/**
 * Starts a recording: the shadow becomes the whole world at the end of this frame, and this
 * frame's slot stays empty, since nothing before it was seen.
 *
 * @param ctx - Domain context of the world plugin.
 * @param history - The empty frame history.
 * @param frame - The first recorded frame.
 */
function startRecording(ctx: WorldCtx, history: History, frame: number): void {
  const state = ctx.state.ecs;

  for (const [entity, owner] of state.owners) {
    history.shadow.set(entity, {
      owner: { kind: owner.kind, name: owner.name },
      components: copiedComponents(state, entity)
    });
  }

  slotFor(history, frame);
  history.started = frame;
  ctx.log.debug("world:history-on", { frames: HISTORY_FRAMES });
}

/**
 * Records one entity the world met for the first time: every JSON component, from nothing.
 *
 * @param state - ecs module state.
 * @param history - The frame history.
 * @param slot - The slot of this frame.
 * @param entity - The new entity.
 * @param owner - Its owner.
 */
function recordSpawn(
  state: EcsState,
  history: History,
  slot: HistorySlot,
  entity: Entity,
  owner: Owner
): void {
  const entry: ShadowEntry = {
    owner: { kind: owner.kind, name: owner.name },
    components: copiedComponents(state, entity)
  };

  for (const [component, value] of entry.components) {
    writeChange(slot, entity, entry.owner, component, absent, value);
  }

  slot.spawned.push(entity);
  history.shadow.set(entity, entry);
}

/**
 * Records one marked component of a known entity when its JSON differs from the shadow, and the
 * shadow takes the new value. A component it no longer carries was recorded when it left; a value
 * that stopped being JSON leaves the record as `snapshot()` leaves it out.
 *
 * @param state - ecs module state.
 * @param slot - The slot of this frame.
 * @param entity - The entity.
 * @param entry - Its shadow entry.
 * @param component - The marked component.
 * @returns True when a record was written.
 */
function recordComponent(
  state: EcsState,
  slot: HistorySlot,
  entity: Entity,
  entry: ShadowEntry,
  component: string
): boolean {
  const before = entry.components.get(component);
  const value = jsonOf(component, state.stores.get(component)?.get(entity));

  if (value === undefined) {
    if (before === undefined) return false;

    writeChange(slot, entity, entry.owner, component, before, absent);
    entry.components.delete(component);

    return true;
  }

  if (before !== undefined && sameJson(before, value)) return false;

  writeChange(slot, entity, entry.owner, component, before ?? absent, value);

  const copy = copyJson(value, before);

  if (copy !== before) entry.components.set(component, copy);

  return true;
}

/**
 * The count of marked and changed rows of one component, made the first time it is seen.
 *
 * @param history - The frame history.
 * @param component - The component name.
 * @returns Its count, mutated in place.
 */
function markCountOf(history: History, component: string): MarkCount {
  const known = history.marks.get(component);

  if (known !== undefined) return known;

  const count: MarkCount = { component, marked: 0, changed: 0 };

  history.marks.set(component, count);
  history.markList.push(count);

  return count;
}

/**
 * Records one frame from its change sets, pair by pair: a new entity as a spawn, whole, once; for
 * a known one only the marked component, compared with its shadow. Counts the marked and changed
 * rows per component and judges them once a window is full.
 *
 * @param ctx - Domain context of the world plugin.
 * @param history - The frame history.
 * @param frame - The frame number.
 */
function recordChangedEntities(ctx: WorldCtx, history: History, frame: number): void {
  const state = ctx.state.ecs;
  const slot = slotFor(history, frame);

  for (const component of state.changed.keys()) {
    const list = state.changed.get(component);

    if (list === undefined) continue;

    for (const entity of list.entities) {
      const owner = state.owners.get(entity);
      const entry = history.shadow.get(entity);

      // An entity that died in this frame was recorded when it died.
      if (owner === undefined) continue;

      if (entry === undefined) {
        recordSpawn(state, history, slot, entity, owner);
        continue;
      }

      const count = markCountOf(history, component);

      count.marked += 1;

      if (recordComponent(state, slot, entity, entry, component)) count.changed += 1;
    }
  }

  history.markFrames += 1;

  if (history.markFrames >= HISTORY_FRAMES) judgeMarks(ctx, history);
}

/**
 * Closes a window of mark counts: a component marked on at least `MARKED_ROWS` rows a frame of
 * which at most one in twenty changed, and named by a `mut()` term of a registered system, is
 * reported once per app. Then every count starts again from 0.
 *
 * @param ctx - Domain context of the world plugin.
 * @param history - The frame history.
 */
function judgeMarks(ctx: WorldCtx, history: History): void {
  // By index over the list: this runs once a window, unoptimized, where any iterator allocates.
  for (let index = 0; index < history.markList.length; index += 1) {
    const count = history.markList[index];

    if (count === undefined) continue;

    const component = count.component;
    const rowsPerFrame = count.marked / history.markFrames;
    const wasted = rowsPerFrame >= MARKED_ROWS && count.changed <= count.marked * CHANGED_SHARE;

    if (wasted && !history.warned.has(component)) {
      const systems = mutSystemsOf(ctx.state.ecs, component);

      if (systems.length > 0) {
        history.warned.add(component);
        ctx.log.warn("world:mut-unchanged", {
          component,
          rowsPerFrame: Math.round(rowsPerFrame * 10) / 10,
          changedShare: Math.round((count.changed / count.marked) * 100) / 100,
          systems
        });
      }
    }

    count.marked = 0;
    count.changed = 0;
  }

  history.markFrames = 0;
}

/**
 * The names of the registered systems whose query writes a component with `mut()`.
 *
 * @param state - ecs module state.
 * @param component - The component name.
 * @returns The system names, in phase and registration order.
 */
function mutSystemsOf(state: EcsState, component: string): string[] {
  const names: string[] = [];

  for (const phase of ["input", "animate", "layout", "sync"] as const) {
    for (const entry of state.systems[phase]) {
      if (entry.plan.written.includes(component)) names.push(entry.definition.name);
    }
  }

  return names;
}

/**
 * Records one frame, before its change sets are cleared: the first frame starts the recording,
 * every later one compares the marked components with the shadow. Every frame gets a slot, also
 * an empty one. Dev builds only: the caller guards it inline.
 *
 * @param ctx - Domain context of the world plugin.
 * @param frame - The frame number.
 */
export function recordFrame(ctx: WorldCtx, frame: number): void {
  const state = ctx.state.ecs;
  const history = state.history ?? {
    shadow: emptyShadow(),
    slots: emptySlots(),
    newest: undefined,
    started: undefined,
    marks: emptyMarks(),
    markList: [],
    markFrames: 0,
    warned: emptyNames()
  };

  state.history = history;

  // The first frame starts the recording; every later one records what changed.
  if (history.newest === undefined) startRecording(ctx, history, frame);
  else recordChangedEntities(ctx, history, frame);

  history.newest = frame;
}

/**
 * Records a despawn before the entity's components go: every component the shadow holds leaves,
 * and the entity leaves the shadow. A no-op without a history and for an entity the history
 * never saw.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity about to be despawned.
 */
export function recordDespawn(ctx: WorldCtx, entity: Entity): void {
  const history = ctx.state.ecs.history;
  const entry = history?.shadow.get(entity);

  if (history === undefined || entry === undefined) return;

  const slot = slotFor(history, openFrame(ctx, history));

  for (const [component, value] of entry.components) {
    writeChange(slot, entity, entry.owner, component, value, absent);
  }

  slot.despawned.push(entity);
  history.shadow.delete(entity);
}

/**
 * Records a component that left a live entity. The removal takes the entity out of that change
 * set, so the frame's recorder would not see it.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity.
 * @param component - The name of the component that left.
 */
export function recordRemoval(ctx: WorldCtx, entity: Entity, component: string): void {
  const history = ctx.state.ecs.history;
  const entry = history?.shadow.get(entity);
  const before = entry?.components.get(component);

  if (history === undefined || entry === undefined || before === undefined) return;

  writeChange(
    slotFor(history, openFrame(ctx, history)),
    entity,
    entry.owner,
    component,
    before,
    absent
  );
  entry.components.delete(component);
}

/**
 * Resets the history to where a dev build starts: no shadow, no slot, no frame. Without a history
 * there is nothing to reset.
 *
 * @param state - ecs module state.
 */
export function resetHistory(state: EcsState): void {
  const history = state.history;

  if (history === undefined) return;

  history.shadow.clear();
  history.slots = emptySlots();
  history.newest = undefined;
  history.started = undefined;
  history.marks.clear();
  history.markList.length = 0;
  history.markFrames = 0;
  history.warned.clear();
}

/**
 * Folds the records of one slot into the entities of a window: the first `from` and the last
 * `to` of every component, and whether the entity came or went.
 *
 * @param folded - The entities folded so far.
 * @param slot - The next slot of the window.
 */
function foldSlot(folded: Map<Entity, Folded>, slot: HistorySlot): void {
  for (let index = 0; index < slot.count; index += 1) {
    const change = slot.changes[index];

    if (change === undefined) continue;

    const entry = folded.get(change.id) ?? {
      id: change.id,
      owner: change.owner,
      pairs: new Map<string, ComponentChange>(),
      spawned: false,
      despawned: false
    };
    const pair = entry.pairs.get(change.component);

    if (pair === undefined) entry.pairs.set(change.component, { from: change.from, to: change.to });
    else pair.to = change.to;

    folded.set(change.id, entry);
  }

  for (const entity of slot.spawned) {
    const entry = folded.get(entity);

    if (entry !== undefined) entry.spawned = true;
  }

  for (const entity of slot.despawned) {
    const entry = folded.get(entity);

    if (entry !== undefined) entry.despawned = true;
  }
}

/**
 * Turns one folded entity into its diff entry. A round trip is no change, and an entity that came
 * and went inside the window is left out.
 *
 * @param entry - The folded entity.
 * @returns The entry, or nothing when no real change is left.
 */
function entityDiffOf(entry: Folded): EntityDiff[] {
  if (entry.spawned && entry.despawned) return [];

  const components: Record<string, ComponentChange> = {};

  for (const [component, pair] of entry.pairs) {
    // The records keep their values for reuse: the diff hands out copies of its own.
    if (!sameJson(pair.from, pair.to)) {
      components[component] = { from: copyJson(pair.from), to: copyJson(pair.to) };
    }
  }

  if (Object.keys(components).length === 0) return [];

  let change: EntityDiff["change"] = "changed";

  if (entry.spawned) change = "spawned";
  else if (entry.despawned) change = "despawned";

  return [
    {
      id: entry.id,
      owner: { kind: entry.owner.kind, name: entry.owner.name },
      // The ecs module knows no projection: the plugin root names the key.
      key: undefined,
      change,
      components
    }
  ];
}

/**
 * The error of a production build, whose world keeps no history.
 *
 * @returns The error, ready to throw.
 */
function devBuildOnly(): Error {
  return new Error(
    "[game] game.diff needs a dev build.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
  );
}

/**
 * The error of a frame the history does not hold.
 *
 * @param frame - The frame that was asked for.
 * @param range - The first and the newest frame the history holds, if it holds any.
 * @param range.first - The first frame a diff can start after.
 * @param range.newest - The last recorded frame.
 * @returns The error, ready to throw.
 */
function notInHistory(frame: number, range?: { first: number; newest: number }): Error {
  const kept =
    range === undefined
      ? `The history keeps the last ${HISTORY_FRAMES} frames and starts with the next frame.`
      : `The history keeps the last ${HISTORY_FRAMES} frames, ${range.first} to ${range.newest}.`;

  return new Error(`[game] game.diff: frame ${frame} is not in the history.\n  ${kept}`);
}

/**
 * Checks that both frames are recorded frames of the window and in order.
 *
 * @param history - The frame history.
 * @param from - The frame the window starts after.
 * @param to - The last frame of the window.
 * @throws {Error} For a frame outside the window, and for `from` after `to`.
 */
function checkWindow(history: History, from: number, to: number): void {
  const { newest, started } = history;

  if (newest === undefined || started === undefined) throw notInHistory(from);

  const first = Math.max(started, newest - HISTORY_FRAMES + 1);
  const outside = (frame: number): boolean =>
    !Number.isInteger(frame) || frame < first || frame > newest;
  const wrong = [from, to].find(frame => outside(frame)) ?? (from > to ? to : undefined);

  if (wrong !== undefined) throw notInHistory(wrong, { first, newest });
}

/**
 * Folds the history over the frames `from + 1 .. to`: what changed between the world at the end
 * of frame `from` and the world at the end of frame `to`. Every key is left `undefined`: the
 * plugin root names it.
 *
 * @param history - The frame history, `undefined` in a production build.
 * @param from - The frame the window starts after.
 * @param to - The last frame of the window.
 * @returns The changed entities, sorted by id.
 * @throws {Error} In a production build, for a frame outside the window, and for `from` after `to`.
 */
export function diffHistory(history: History | undefined, from: number, to: number): FrameDiff {
  if (history === undefined) throw devBuildOnly();

  checkWindow(history, from, to);

  const folded = emptyFold();

  for (let frame = from + 1; frame <= to; frame += 1) {
    const slot = history.slots[frame % HISTORY_FRAMES];

    // Every frame of the window has its slot; the check only narrows the type.
    if (slot !== undefined) foldSlot(folded, slot);
  }

  const entities = [...folded.values()]
    .flatMap(entry => entityDiffOf(entry))
    .toSorted((left, right) => left.id - right.id);

  return { from, to, entities };
}
