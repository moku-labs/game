/**
 * @file world/ecs — the frame history of a dev build: one shadow copy of the world as JSON and a
 * ring with the change records of the last frames, so `diff` can say what changed between two
 * frames. Records cost memory only when something changes: 120 full snapshots of a big board
 * would not fit a phone.
 *
 * Only `recordFrame` starts a history, and `lifecycle.ts` calls it behind the inline dev guard,
 * so a production bundle drops the recorder and `history` stays `undefined`. The other writers
 * here do nothing without a history.
 */
import type { Json } from "../../model/types";
import type { WorldCtx } from "../types";
import { componentsOf } from "./snapshot";
import type {
  ComponentChange,
  EcsState,
  Entity,
  EntityDiff,
  FrameDiff,
  History,
  HistorySlot,
  Owner,
  ShadowEntry
} from "./types";

/** How many frames the history keeps: 2 s at 60 fps, so a glitch seen by eye is still in it. */
export const HISTORY_FRAMES = 120;

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
 * Creates the empty table a fold fills, for the same L5 reason.
 *
 * @returns An empty table of entity to folded entity.
 */
function emptyFold(): Map<Entity, Folded> {
  return new Map();
}

/**
 * Compares two JSON values structurally, the rule the projection's component diff uses.
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

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;

    return left.every((entry, index) => {
      const other = right[index];

      return other !== undefined && sameJson(entry, other);
    });
  }

  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) return false;

  return keys.every(key => {
    const mine = left[key];
    const other = right[key];

    return mine !== undefined && other !== undefined && sameJson(mine, other);
  });
}

/**
 * The slot of one frame, written fresh when the ring still holds an older frame at its index.
 *
 * @param history - The frame history.
 * @param frame - The frame number.
 * @returns The slot of that frame.
 */
function slotFor(history: History, frame: number): HistorySlot {
  const index = frame % HISTORY_FRAMES;
  const known = history.slots[index];

  if (known?.frame === frame) return known;

  const fresh: HistorySlot = { frame, changes: [], spawned: [], despawned: [] };

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
    copies.set(name, structuredClone(value));
  }

  return copies;
}

/**
 * The entities of every change set of the frame, each once.
 *
 * @param state - ecs module state.
 * @returns The changed entities, in the order the change sets met them.
 */
function changedEntities(state: EcsState): Set<Entity> {
  const entities = new Set<Entity>();

  for (const changed of state.changed.values()) {
    for (const entity of changed) entities.add(entity);
  }

  return entities;
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
    slot.changes.push({ id: entity, owner: entry.owner, component, from: absent, to: value });
  }

  slot.spawned.push(entity);
  history.shadow.set(entity, entry);
}

/**
 * Records what changed on one known entity: every component whose JSON differs from the shadow,
 * and every recorded component it no longer carries. The shadow takes the new values.
 *
 * @param state - ecs module state.
 * @param slot - The slot of this frame.
 * @param entity - The entity.
 * @param entry - Its shadow entry.
 */
function recordChanges(
  state: EcsState,
  slot: HistorySlot,
  entity: Entity,
  entry: ShadowEntry
): void {
  const now = componentsOf(state, entity).components;

  for (const [component, value] of Object.entries(now)) {
    const before = entry.components.get(component);

    if (before !== undefined && sameJson(before, value)) continue;

    const copy = structuredClone(value);

    slot.changes.push({
      id: entity,
      owner: entry.owner,
      component,
      from: before ?? absent,
      to: copy
    });
    entry.components.set(component, copy);
  }

  for (const [component, before] of entry.components) {
    if (Object.hasOwn(now, component)) continue;

    slot.changes.push({ id: entity, owner: entry.owner, component, from: before, to: absent });
    entry.components.delete(component);
  }
}

/**
 * Records every entity that changed in one frame into that frame's slot: a new entity as a spawn,
 * a known one as its component changes.
 *
 * @param state - ecs module state.
 * @param history - The frame history.
 * @param frame - The frame number.
 */
function recordChangedEntities(state: EcsState, history: History, frame: number): void {
  const slot = slotFor(history, frame);

  for (const entity of changedEntities(state)) {
    const owner = state.owners.get(entity);
    const entry = history.shadow.get(entity);

    // An entity that died in this frame was recorded when it died.
    if (owner === undefined) continue;

    if (entry === undefined) recordSpawn(state, history, slot, entity, owner);
    else recordChanges(state, slot, entity, entry);
  }
}

/**
 * Records one frame, before its change sets are cleared: the first frame starts the recording,
 * every later one compares the changed entities with the shadow. Every frame gets a slot, also
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
    started: undefined
  };

  state.history = history;

  // The first frame starts the recording; every later one records what changed.
  if (history.newest === undefined) startRecording(ctx, history, frame);
  else recordChangedEntities(state, history, frame);

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
    slot.changes.push({ id: entity, owner: entry.owner, component, from: value, to: absent });
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

  slotFor(history, openFrame(ctx, history)).changes.push({
    id: entity,
    owner: entry.owner,
    component,
    from: before,
    to: absent
  });
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
}

/**
 * Folds the records of one slot into the entities of a window: the first `from` and the last
 * `to` of every component, and whether the entity came or went.
 *
 * @param folded - The entities folded so far.
 * @param slot - The next slot of the window.
 */
function foldSlot(folded: Map<Entity, Folded>, slot: HistorySlot): void {
  for (const change of slot.changes) {
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
    if (!sameJson(pair.from, pair.to)) components[component] = pair;
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
