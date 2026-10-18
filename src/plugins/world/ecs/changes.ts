/**
 * @file world/ecs — the coarse change lists of one frame. A component's list is kept from frame
 * to frame and emptied in place, so marking and clearing allocate nothing once the list has grown
 * to its frame's size. A `Set` cannot do that in V8: its `clear()` and a shrinking `delete`
 * allocate a new table, and its growth allocates again on the next frame (measured, 2026-10-18:
 * 100 marks and a clear cost 5.4 KB a frame).
 */
import type { ChangeList, EcsState, Entity } from "./types";

/**
 * What `changed()` answers for a component nothing marked this frame. Not frozen: V8 walks a
 * frozen array with `for…of` through a generic iterator that allocates 88 B a loop, a plain one
 * through the inlined fast path that allocates nothing. Read-only by its type.
 */
const NO_CHANGES: readonly Entity[] = [];

/**
 * Creates the empty list of one component. It lives in its own non-exported function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns A list with nothing marked.
 */
function emptyList(): ChangeList {
  return { entities: [], frames: new Map() };
}

/**
 * Takes one entity out of a list, keeping the order of the others. The tail is popped, never cut
 * with `length`: cutting releases the array's store, and the next mark would allocate it again.
 *
 * @param list - The list.
 * @param entity - The entity.
 */
function unlist(list: ChangeList, entity: Entity): void {
  const entities = list.entities;
  const at = entities.indexOf(entity);

  if (at === -1) return;

  entities.copyWithin(at, at + 1);
  entities.pop();
}

/**
 * Marks an entity changed for one component; a second mark in the same frame is a no-op.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @param entity - The entity that changed.
 */
export function markChanged(state: EcsState, name: string, entity: Entity): void {
  let list = state.changed.get(name);

  if (list === undefined) {
    list = emptyList();
    state.changed.set(name, list);
  }

  // Per mark: the frame stamp replaces a Set; a known key takes a new Smi without allocating.
  if (list.frames.get(entity) === state.changeFrame) return;

  list.frames.set(entity, state.changeFrame);
  list.entities.push(entity);
}

/**
 * Reads the change list of one component.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @returns The entities marked changed for it this frame, in mark order: the live list, or one
 *   shared empty list.
 */
export function changesOf(state: EcsState, name: string): Iterable<Entity> {
  const list = state.changed.get(name);

  return list === undefined || list.entities.length === 0 ? NO_CHANGES : list.entities;
}

/**
 * Empties one list in place: popped, so the array keeps its store for the next frame.
 *
 * @param list - The list.
 */
function emptyInPlace(list: ChangeList): void {
  const entities = list.entities;

  while (entities.length > 0) entities.pop();
}

/**
 * Empties every change list. Runs in `time` phase `signals`. The frame stamp moves on, so a stamp
 * of the frame before no longer counts as a mark.
 *
 * @param state - ecs module state.
 */
export function clearAllChanges(state: EcsState): void {
  state.changeFrame += 1;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.changed.forEach(emptyInPlace);
}

/**
 * Drops the stamp of one entity in one list, and takes it out of the list when it was marked in
 * this frame.
 *
 * @param list - The list.
 * @param entity - The entity.
 * @param frame - The current frame stamp.
 */
function unmark(list: ChangeList, entity: Entity, frame: number): void {
  const stamp = list.frames.get(entity);

  if (stamp === undefined) return;

  list.frames.delete(entity);
  if (stamp === frame) unlist(list, entity);
}

/** What `forgetChanges` takes out, read by its module-level callback: no closure per call. */
const forgetting = { entity: 0, frame: 0 };

/**
 * Takes the entity of `forgetChanges` out of one list.
 *
 * @param list - The list.
 */
function forgetIn(list: ChangeList): void {
  unmark(list, forgetting.entity, forgetting.frame);
}

/**
 * Takes one entity out of one component's list, as a removal of that component does.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @param entity - The entity that lost the component.
 */
export function unmarkChanged(state: EcsState, name: string, entity: Entity): void {
  const list = state.changed.get(name);

  if (list !== undefined) unmark(list, entity, state.changeFrame);
}

/**
 * Takes one entity out of every change list, so a despawned entity is never reported.
 *
 * @param state - ecs module state.
 * @param entity - The entity that left.
 */
export function forgetChanges(state: EcsState, entity: Entity): void {
  forgetting.entity = entity;
  forgetting.frame = state.changeFrame;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.changed.forEach(forgetIn);
}
