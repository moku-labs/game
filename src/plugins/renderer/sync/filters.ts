/**
 * @file renderer/sync — the filters `effects` hangs on entities' views, the rectangle they draw inside, and the render
 * passes they cost. The renderer never creates, writes or destroys a filter: it keeps the slot list per entity, assigns
 * the instances to the view, and takes them off when it lets the object go. The area (B4) is kept per entity the same
 * way and written into one Pixi `Rectangle` on the view's top, in its own units.
 */
import type { EcsApi } from "../../world/ecs/types";
import type { Entity } from "../../world/types";
import type { KeptState } from "../kept/types";
import type { KeptModule, PixiContainer, PixiFilter, PixiRectangle } from "../types";
import type { AreaEntry, FilterSlot, SyncCtx, SyncState, View } from "./types";

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

  // A blur draws through two pass filters of its own: they count under the blur's kind.
  if ("blurXFilter" in filter && isFilterObject(filter.blurXFilter)) {
    state.filterKinds.set(filter.blurXFilter, kind);
  }

  if ("blurYFilter" in filter && isFilterObject(filter.blurYFilter)) {
    state.filterKinds.set(filter.blurYFilter, kind);
  }
}

/**
 * Tells whether a property a filter may carry holds an object: the pass filter Pixi's blur keeps under it. Pure.
 *
 * @param value - The property's value.
 * @returns True for an object that is not `null`.
 * @example
 * ```ts
 * isFilterObject(null); // false
 * ```
 */
function isFilterObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
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
  // Kept for an entity without a view: the pass looks for its despawn.
  else if (slots.length > 0) state.viewlessEntries = true;

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
 * Forgets the filters and the filter area of an entity whose view left, only when the entity itself is gone. A live
 * entity keeps them for its next view, in this frame, as a `ui` element that swaps its shape for a
 * nine-slice, or in a later one.
 *
 * @param state - The sync branch of the plugin state.
 * @param ecs - The world's ecs, asked whether the entity still lives.
 * @param entity - An entity of the pass's removed set.
 */
export function forgetLeft(state: SyncState, ecs: Pick<EcsApi, "ownerOf">, entity: Entity): void {
  if (ecs.ownerOf(entity) !== undefined) return;

  state.filters.delete(entity);
  state.areas.delete(entity);
}

/**
 * The rectangle a display object's filters are drawn inside. Pixi answers `undefined` before the
 * object has a filter effect and `null` after (the effect's own starting value), which its getter
 * type does not say.
 *
 * @param target - The display object.
 * @returns The rectangle, `undefined` when it has none.
 */
function heldArea(target: PixiContainer): PixiRectangle | undefined {
  const held: PixiRectangle | null | undefined = target.filterArea;

  return held ?? undefined;
}

/**
 * Takes the filter area off a display object: its filters draw over its bounds again. Nothing is
 * written when it holds none.
 *
 * @param target - The display object.
 */
export function clearArea(target: PixiContainer): void {
  // `null` is the value Pixi's own filter effect starts with; the declaration of the setter only says `Rectangle`.
  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi holds no filter area.
  if (heldArea(target) !== undefined) Reflect.set(target, "filterArea", null);
}

/**
 * Writes the filter area of an entity onto its view, the one writer of `filterArea`: on the view's top (its wrapper
 * when it has one, so the area covers the subtree as the filters do), in the top's own units. Without a wrapper the
 * stretch of the visual is folded into the object's scale (`applyTransform`), so the entity's units are divided by it;
 * a wrapper carries the pose alone. Written into the entity's one `Rectangle` only when the target does not hold it or
 * a number differs, and the entity is marked before (C-c). Without an entry the area the renderer wrote comes off.
 *
 * While the view is drawn from its kept picture its filters hang on the picture's stand-in (spec 23), which draws
 * without an area: the top keeps it, inert without filters, and it is in force again the frame the filters come back.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyArea(sctx: SyncCtx, entity: Entity, view: View): void {
  const entry = sctx.ctx.state.sync.areas.get(entity);
  const target = view.wrapper ?? view.object;
  const held = heldArea(target);

  // No entry: the area the renderer wrote comes off.
  if (entry === undefined) {
    if (held === undefined) return;

    sctx.deps.demand.mark(entity);
    clearArea(target);

    return;
  }

  // The entity's units in the top's: a wrapper carries the pose alone, a bare object the stretch of its visual too.
  const stretch = view.wrapper === undefined ? view.drawScale : undefined;
  const sx = scaleOrOne(stretch?.x);
  const sy = scaleOrOne(stretch?.y);

  if (holdsArea(held, entry, sx, sy)) return;

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return;

  // A new area is structural: the entity is marked before the write, into its one rectangle.
  sctx.deps.demand.mark(entity);

  const next = entry.rect ?? new pixi.Rectangle();

  entry.rect = next;
  next.x = entry.x / sx;
  next.y = entry.y / sy;
  next.width = entry.width / sx;
  next.height = entry.height / sy;
  if (held !== next) target.filterArea = next;
}

/**
 * The scale an area is divided by on one axis: the visual's stretch, or 1 without one. A stretch of 0 draws nothing,
 * so the area is then left in the entity's units. Pure.
 *
 * @param stretch - The stretch on that axis, `undefined` for a top with a wrapper.
 * @returns The divisor.
 * @example
 * ```ts
 * scaleOrOne(0); // 1
 * ```
 */
function scaleOrOne(stretch: number | undefined): number {
  return stretch === undefined || stretch === 0 ? 1 : stretch;
}

/**
 * Tells whether a top holds the entity's rectangle with the numbers of its entry already, divided by the stretch:
 * nothing to write.
 *
 * @param held - The area the top holds.
 * @param entry - The entity's entry.
 * @param sx - The divisor on x.
 * @param sy - The divisor on y.
 * @returns True when the area stands.
 */
function holdsArea(
  held: PixiRectangle | undefined,
  entry: AreaEntry,
  sx: number,
  sy: number
): boolean {
  const rect = entry.rect;

  return (
    rect !== undefined &&
    held === rect &&
    rect.x === entry.x / sx &&
    rect.y === entry.y / sy &&
    rect.width === entry.width / sx &&
    rect.height === entry.height / sy
  );
}

/**
 * A new entry of the area map: no rectangle until its first write.
 *
 * @returns The entry, at zero.
 */
function emptyArea(): AreaEntry {
  return { x: 0, y: 0, width: 0, height: 0, rect: undefined };
}

/**
 * Keeps the filter area of an entity and writes it onto its view when it has one; `undefined` forgets it and takes the
 * area the renderer wrote off the view. Works while inert: stored, applied when the view is built.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param area - x, y, width, height in the entity's own units, or `undefined`.
 */
export function setArea(
  sctx: SyncCtx,
  entity: Entity,
  area: readonly [number, number, number, number] | undefined
): void {
  const state = sctx.ctx.state.sync;

  if (area === undefined) {
    state.areas.delete(entity);
  } else {
    let entry = state.areas.get(entity);

    if (entry === undefined) {
      entry = emptyArea();
      state.areas.set(entity, entry);
    }

    [entry.x, entry.y, entry.width, entry.height] = area;
  }

  const view = state.views.get(entity);

  if (view !== undefined) applyArea(sctx, entity, view);
  // Kept for an entity without a view: the pass looks for its despawn.
  else if (area !== undefined) state.viewlessEntries = true;
}

/**
 * Moves the filter area of an entity from its object to the wrapper it has just been given, as `moveFilters` moves the
 * filters: the object's area comes off, the wrapper's is written in the wrapper's units.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view, wrapper set.
 */
export function moveArea(sctx: SyncCtx, entity: Entity, view: View): void {
  if (heldArea(view.object) !== undefined) {
    sctx.deps.demand.mark(entity);
    clearArea(view.object);
  }

  applyArea(sctx, entity, view);
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
