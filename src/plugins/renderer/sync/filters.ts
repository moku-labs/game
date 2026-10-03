/**
 * @file renderer/sync — the filters `effects` hangs on entities' views, and the render passes they
 * cost. The renderer never creates, writes or destroys a filter: it keeps the slot list per
 * entity, assigns the instances to the view, and takes them off when it lets the object go.
 */
import type { EcsApi } from "../../world/ecs/types";
import type { Entity } from "../../world/types";
import type { PixiContainer, PixiFilter } from "../types";
import type { FilterSlot, SyncState, View } from "./types";

/**
 * The filters a display object holds now. Pixi answers `undefined` before the first write and
 * `null` after a clear, which its getter type does not say.
 *
 * @param target - The display object.
 * @returns The filters, empty when there are none.
 */
function heldFilters(target: PixiContainer): readonly PixiFilter[] {
  const held: readonly PixiFilter[] | null | undefined = target.filters;

  return held ?? [];
}

/**
 * Tells whether a display object holds exactly these filter instances, in this order.
 *
 * @param target - The display object.
 * @param slots - The slots to compare with.
 * @returns True when nothing has to be written.
 */
function holds(target: PixiContainer, slots: readonly FilterSlot[]): boolean {
  const held = heldFilters(target);

  return held.length === slots.length && slots.every((slot, index) => held[index] === slot.filter);
}

/**
 * Takes every filter off a display object. Nothing is written when it holds none: Pixi copies the
 * list on every assignment and may rebuild the render group.
 *
 * @param target - The display object.
 */
export function clearFilters(target: PixiContainer): void {
  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  if (heldFilters(target).length > 0) target.filters = null;
}

/**
 * Hangs the filters on a view: on its wrapper when it has one, so they cover the entity's whole
 * subtree, otherwise on the object. Written only when the instances differ from what the target
 * holds.
 *
 * @param view - The view.
 * @param slots - The filters in draw order; empty clears them.
 */
export function applyFilters(view: View, slots: readonly FilterSlot[]): void {
  const target = view.wrapper ?? view.object;

  if (holds(target, slots)) return;

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  target.filters = slots.length === 0 ? null : slots.map(slot => slot.filter);
}

/**
 * The filters kept for an entity.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @returns Its slots, empty when it has none.
 */
export function filtersOf(state: SyncState, entity: Entity): readonly FilterSlot[] {
  return state.filters.get(entity) ?? [];
}

/**
 * Keeps the filters of an entity and writes them onto its view when it has one. An empty list
 * forgets the entity.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param slots - The filters in draw order.
 */
export function setFilters(state: SyncState, entity: Entity, slots: readonly FilterSlot[]): void {
  if (slots.length === 0) state.filters.delete(entity);
  else state.filters.set(entity, [...slots]);

  const view = state.views.get(entity);

  if (view !== undefined) applyFilters(view, slots);
}

/**
 * Moves the filters of an entity from its object to the wrapper it has just been given.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param view - Its view, wrapper set.
 */
export function moveFilters(state: SyncState, entity: Entity, view: View): void {
  const slots = state.filters.get(entity);

  if (slots === undefined) return;

  clearFilters(view.object);
  applyFilters(view, slots);
}

/**
 * Forgets the filters of an entity whose view left, only when the entity itself is gone. A live
 * entity keeps them for its next view, in this frame, as a `ui` element that swaps its shape for a
 * nine-slice, or in a later one.
 *
 * @param state - The sync branch of the plugin state.
 * @param ecs - The world's ecs, asked whether the entity still lives.
 * @param entity - An entity of the pass's removed set.
 */
export function forgetLeft(state: SyncState, ecs: Pick<EcsApi, "ownerOf">, entity: Entity): void {
  if (ecs.ownerOf(entity) === undefined) state.filters.delete(entity);
}

/**
 * Tells whether a display object hangs in the drawn tree: its parents lead to the root.
 *
 * @param object - The display object.
 * @param root - The root container of the renderer.
 * @returns True when the object is drawn.
 */
function inTree(object: PixiContainer, root: PixiContainer): boolean {
  for (let parent = object.parent; parent !== null; parent = parent.parent) {
    if (parent === root) return true;
  }

  return false;
}

/**
 * The passes one filtered view costs: its content once, then every apply of its enabled filters.
 * A disabled filter costs nothing, and a view whose filters are all disabled is drawn unfiltered.
 *
 * @param slots - The filters of the view.
 * @returns The passes; 0 when no filter is enabled.
 */
function passesOf(slots: readonly FilterSlot[]): number {
  let passes = 0;

  for (const slot of slots) if (slot.filter.enabled) passes += slot.passes;

  return slots.some(slot => slot.filter.enabled) ? 1 + passes : 0;
}

/**
 * The render passes of a frame: 1 for the frame, plus what every filtered view in the tree costs.
 * Read from the slots, never asked of the GPU.
 *
 * @param state - The sync branch of the plugin state.
 * @returns The passes; 0 while inert.
 */
export function renderPassesOf(state: SyncState): number {
  const root = state.root;

  if (root === undefined) return 0;

  let passes = 1;

  for (const [entity, slots] of state.filters) {
    const view = state.views.get(entity);

    if (view !== undefined && inTree(view.wrapper ?? view.object, root)) passes += passesOf(slots);
  }

  return passes;
}
