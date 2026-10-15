/**
 * @file renderer/sync — the filters `effects` hangs on entities' views, and the render passes they
 * cost. The renderer never creates, writes or destroys a filter: it keeps the slot list per
 * entity, assigns the instances to the view, and takes them off when it lets the object go.
 */
import type { EcsApi } from "../../world/ecs/types";
import type { Entity } from "../../world/types";
import type { KeptState } from "../kept/types";
import type { KeptModule, PixiContainer, PixiFilter } from "../types";
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
 * subtree, otherwise on the object; on the stand-in of its kept picture while it has one
 * (`kept.filterTarget`, spec 23 P9.1). Written only when the instances differ from what the target
 * holds, and `before` runs once just before that write: the caller marks the entity there.
 *
 * @param view - The view.
 * @param slots - The filters in draw order; empty clears them.
 * @param before - Called once, before the write, when there is one.
 * @param target - Where the filters hang: the view's top unless the kept cache says otherwise.
 */
export function applyFilters(
  view: View,
  slots: readonly FilterSlot[],
  before: () => void,
  target: PixiContainer = view.wrapper ?? view.object
): void {
  if (holds(target, slots)) return;

  before();

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
 * Notes the kind of a slot's filter for the performance log: the filter itself, the stage filters
 * of its inputs and, for a blur, the two pass filters Pixi applies in its place. A slot without a
 * kind is left out: it counts as "other".
 *
 * @param state - The sync branch of the plugin state.
 * @param slot - The slot.
 */
function nameKind(state: SyncState, slot: FilterSlot): void {
  const { filter, kind } = slot;

  if (kind === undefined) return;

  state.filterKinds.set(filter, kind);

  const stages = slot.inputs?.stages;

  if (stages !== undefined) for (const stage of stages) state.filterKinds.set(stage, kind);

  if (
    "blurXFilter" in filter &&
    typeof filter.blurXFilter === "object" &&
    filter.blurXFilter !== null
  ) {
    state.filterKinds.set(filter.blurXFilter, kind);
  }

  if (
    "blurYFilter" in filter &&
    typeof filter.blurYFilter === "object" &&
    filter.blurYFilter !== null
  ) {
    state.filterKinds.set(filter.blurYFilter, kind);
  }
}

/**
 * Keeps the filters of an entity and writes them onto its view when it has one, then tells the
 * kept cache (spec 23 P9.1). An empty list forgets the entity. A new list on the view is
 * structural: `mark` runs before it is written.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param slots - The filters in draw order.
 * @param mark - Marks the entity before its view is written.
 * @param kept - The kept cache: where the filters hang, and the record it keeps.
 */
export function setFilters(
  state: SyncState,
  entity: Entity,
  slots: readonly FilterSlot[],
  mark: (entity: Entity) => void,
  kept: KeptModule
): void {
  if (slots.length === 0) state.filters.delete(entity);
  else state.filters.set(entity, [...slots]);

  // Inline and positive: Bun folds the agent guard under a production `define`.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    for (const slot of slots) nameKind(state, slot);
  }

  const view = state.views.get(entity);

  if (view !== undefined) applyFilters(view, slots, () => mark(entity), kept.filterTarget(view));

  kept.slots(entity, slots);
}

/**
 * Moves the filters of an entity from its object to the wrapper it has just been given. Nothing
 * while its picture is kept: the filters hang on the stand-in, and the wrapper is a new top, so
 * the next flush draws it live and moves them (spec 23 P9.1).
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param view - Its view, wrapper set.
 * @param before - Called before a write of the object's or the wrapper's filters.
 * @param kept - The kept state.
 */
export function moveFilters(
  state: SyncState,
  entity: Entity,
  view: View,
  before: () => void,
  kept: KeptState
): void {
  const slots = state.filters.get(entity);

  if (slots === undefined || kept.byEntity.get(entity)?.mode === "kept") return;

  if (heldFilters(view.object).length > 0) before();
  clearFilters(view.object);
  applyFilters(view, slots, before);
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
 * Tells whether a display object is drawn under the root: it and every node up to the root are visible and renderable.
 * A node hidden by `"empty"`, `"alpha"` (spec 26 R1.5), `"kept"` or `"freeze"` takes its whole subtree out of the
 * frame: Pixi runs none of the filters under it.
 *
 * @param object - The display object.
 * @param root - The root container of the renderer.
 * @returns True when the object is drawn.
 */
function drawnUnder(object: PixiContainer, root: PixiContainer): boolean {
  for (let node: PixiContainer | null = object; node !== null; node = node.parent) {
    if (!node.visible || !node.renderable) return false;
    if (node === root) return true;
  }

  return false;
}

/**
 * Tells whether the view of a filtered entity is drawn this frame: it exists and its top is drawn under the root. A
 * view outside the tree, hidden, or inside another view's kept picture costs no pass.
 *
 * @param view - The view of the entity, `undefined` when it has none.
 * @param root - The root container of the renderer.
 * @returns True when the view is drawn.
 */
function isDrawn(view: View | undefined, root: PixiContainer): view is View {
  return view !== undefined && drawnUnder(view.wrapper ?? view.object, root);
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
 * The render passes of a frame: 1 for the frame, plus what every filtered view drawn under the root costs, a view
 * drawn from its kept picture and every view inside one excepted, plus what the last flush of the kept cache cost
 * (spec 23 P9.2). Read from the slots, never asked of the GPU.
 *
 * @param state - The sync branch of the plugin state.
 * @param kept - The kept state.
 * @returns The passes; 0 while inert.
 */
export function renderPassesOf(state: SyncState, kept: KeptState): number {
  const root = state.root;

  if (root === undefined) return 0;

  let passes = 1 + kept.flushPasses;

  for (const [entity, slots] of state.filters) {
    if (kept.byEntity.get(entity)?.mode === "kept") continue;
    if (isDrawn(state.views.get(entity), root)) passes += passesOf(slots);
  }

  return passes;
}
