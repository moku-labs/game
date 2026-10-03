/**
 * @file effects/filters — the `sync` system that keeps one filter instance per view and kind,
 * writes them, hands the sorted list to `renderer.sync.filters.set` only when the kinds, their
 * order or their passes changed, destroys what left, and keeps the two filter budgets. It walks
 * the views the world hooks recorded, never the whole world.
 */
import { NineSlice, Shape, Sprite, Transform } from "../../renderer/components";
import type { FilterSlot, PixiModule, ViewportSize } from "../../renderer/types";
import type { AnySystem, Entity } from "../../world/types";
import type { EffectsCtx } from "../types";
import { checkShader } from "./check";
import { createFilter, destroyFilter, writeFilter } from "./instance";
import type { FilteredView, FilterInstance, FilterKind } from "./types";

/**
 * Creates the record of a view with no filter yet. Its change marks and its sorted list are made
 * here once and reused every frame.
 *
 * @returns An empty view.
 */
function emptyView(): FilteredView {
  return {
    kinds: new Set(),
    instances: new Map(),
    retired: [],
    assigned: [],
    changed: new Set(),
    placed: []
  };
}

/**
 * Marks on each view the Pixi-core kinds whose component changed this frame. A core kind is
 * written only then; ours are written every frame.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function markCoreChanges(ectx: EffectsCtx): void {
  const { state, deps } = ectx;

  for (const kind of state.kinds.values()) {
    if (kind.source !== "core") continue;

    for (const entity of deps.world.ecs.changed(kind.component)) {
      state.views.get(entity)?.changed.add(kind.id);
    }
  }
}

/**
 * Sorts instances by their `order`, then by the index of their kind.
 *
 * @param a - One instance.
 * @param b - The other.
 * @returns Negative when `a` goes first.
 */
function byOrder(a: FilterInstance, b: FilterInstance): number {
  return a.order - b.order || a.index - b.index;
}

/**
 * Tells whether the sorted instances of this frame differ from the last list handed over: other
 * instances, another order, or other passes.
 *
 * @param assigned - The last list handed over.
 * @param placed - The sorted instances of this frame.
 * @returns True when the renderer must get a new list.
 */
function differs(assigned: readonly FilterSlot[], placed: readonly FilterInstance[]): boolean {
  if (assigned.length !== placed.length) return true;

  // Walk both lists side by side; a counter instead of `entries()`, which builds a pair per item.
  let index = 0;

  for (const instance of placed) {
    const slot = assigned[index];

    index += 1;

    if (slot?.filter !== instance.filter || slot.passes !== instance.passes) return true;
  }

  return false;
}

/**
 * Brings one kind of one view up to date: the first frame it is seen it gets its instance, once
 * its shader check answered ok; after that it is written.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param entity - The entity.
 * @param view - Its record.
 * @param kind - The kind.
 * @param changed - Whether its component changed this frame.
 * @returns The instance, its `order` up to date, or `undefined` while it has none.
 */
function syncKind(
  ectx: EffectsCtx,
  pixi: PixiModule,
  entity: Entity,
  view: FilteredView,
  kind: FilterKind,
  changed: boolean
): FilterInstance | undefined {
  const value = ectx.deps.world.ecs.get(entity, kind.component);

  if (value === undefined) return undefined;

  let instance = view.instances.get(kind.id);

  if (instance === undefined) {
    if (checkShader(ectx, kind) !== "ok") return undefined;

    instance = createFilter(ectx, pixi, kind, value);

    if (instance === undefined) return undefined;

    view.instances.set(kind.id, instance);
  } else {
    writeFilter(ectx, instance, value, changed);
    instance.order = value.order;
  }

  return instance;
}

/**
 * Brings one view up to date, hands the renderer a new frozen slot list when it differs, then
 * destroys what left. A view with nothing left is forgotten; a despawned one gets no call, since
 * the renderer cleared its view when it released it.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param entity - The entity.
 * @param view - Its record.
 */
function syncView(ectx: EffectsCtx, pixi: PixiModule, entity: Entity, view: FilteredView): void {
  // Bring every kind of the view up to date, consuming its change mark, and collect the instances
  // it has into the view's own list.
  const { placed } = view;

  placed.length = 0;

  for (const id of view.kinds) {
    const kind = ectx.state.kinds.get(id);
    const changed = view.changed.delete(id);
    const instance =
      kind === undefined ? undefined : syncKind(ectx, pixi, entity, view, kind, changed);

    if (instance !== undefined) placed.push(instance);
  }

  // A kind that left this frame leaves no mark behind for a later frame.
  if (view.changed.size > 0) view.changed.clear();

  // Hand the renderer a new frozen list only when the sorted instances changed.
  placed.sort(byOrder);

  if (differs(view.assigned, placed)) {
    const slots = placed.map(instance => ({
      filter: instance.filter,
      passes: instance.passes
    }));

    // A despawned entity gets no call: the renderer forgot its slots when it let the view go.
    const needsSet = slots.length > 0 || ectx.deps.world.ecs.ownerOf(entity) !== undefined;

    if (needsSet) ectx.deps.renderer.sync.filters.set(entity, Object.freeze(slots));

    view.assigned = slots;
  }

  // Destroy what left only now, after the renderer stopped drawing it.
  if (view.retired.length > 0) {
    for (const retired of view.retired.splice(0)) destroyFilter(retired);
  }

  // Forget a view with nothing left on it.
  if (view.kinds.size === 0 && view.instances.size === 0) ectx.state.views.delete(entity);
}

/**
 * Tells whether a box of a view, times the view's scale, covers the viewport on both axes.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param entity - The entity.
 * @param width - The width of its box, reference units.
 * @param height - The height of its box.
 * @param size - The viewport size.
 * @returns True when the scaled box covers the viewport.
 */
function boxCovers(
  ectx: EffectsCtx,
  entity: Entity,
  width: number,
  height: number,
  size: ViewportSize
): boolean {
  const scale = ectx.deps.world.ecs.get(entity, Transform)?.scale ?? 1;

  return width * scale >= size.width && height * scale >= size.height;
}

/**
 * Tells whether a filtered view covers the whole viewport: the box its sprite, its nine-slice or
 * its shape declares, times its scale, covers the reference size on both axes. A sprite without a
 * size declares none. Read from components, never from Pixi bounds.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param entity - The entity.
 * @param size - The viewport size.
 * @returns True for a full-screen view.
 */
function coversScreen(ectx: EffectsCtx, entity: Entity, size: ViewportSize): boolean {
  const ecs = ectx.deps.world.ecs;
  const sprite = ecs.get(entity, Sprite);

  if (sprite !== undefined) {
    if (sprite.width <= 0 || sprite.height <= 0) return false;

    return boxCovers(ectx, entity, sprite.width, sprite.height, size);
  }

  const nine = ecs.get(entity, NineSlice);

  if (nine !== undefined) return boxCovers(ectx, entity, nine.width, nine.height, size);

  const shape = ecs.get(entity, Shape);

  return shape !== undefined && boxCovers(ectx, entity, shape.w, shape.h, size);
}

/**
 * Tells whether a view has at least one enabled filter instance.
 *
 * @param view - The view.
 * @returns True when one of its instances is enabled.
 */
function hasEnabledFilter(view: FilteredView): boolean {
  for (const instance of view.instances.values()) {
    if (instance.filter.enabled) return true;
  }

  return false;
}

/**
 * Warns once per crossing of the pass budget: the renderer's render passes over
 * `config.maxPasses`. The count walks the renderer's filtered views, so it is read only while a
 * view carries a filter; with none the frame draws at most one pass and the budget cannot trip.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function checkPassBudget(ectx: EffectsCtx): void {
  const { state, config, deps } = ectx;

  // No filtered view: at most one pass, under any budget.
  if (state.views.size === 0) {
    state.over.passes = false;

    return;
  }

  // Warn once when the renderer's passes cross `maxPasses`.
  const passes = deps.renderer.sync.renderPasses();
  const overPasses = passes > config.maxPasses;

  if (overPasses && !state.over.passes) {
    ectx.log.warn("effects:pass-budget", { passes, budget: config.maxPasses });
  }

  state.over.passes = overPasses;
}

/**
 * Warns once per crossing of each filter budget: the renderer's render passes over
 * `config.maxPasses`, and more than one full-screen view with an enabled filter.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function checkBudgets(ectx: EffectsCtx): void {
  const { state, deps } = ectx;

  checkPassBudget(ectx);

  // The full-screen budget: count the views that cover the viewport with an enabled filter.
  const size = deps.renderer.viewport.size();
  let count = 0;

  for (const [entity, view] of state.views) {
    if (hasEnabledFilter(view) && coversScreen(ectx, entity, size)) count += 1;
  }

  // Warn once when more than one such view is on screen.
  const overScreen = count > 1;

  if (overScreen && !state.over.fullScreen) {
    ectx.log.warn("effects:full-screen-filters", { count });
  }

  state.over.fullScreen = overScreen;
}

/**
 * Builds the `sync` system of the filters. It runs in every world mode, so a paused game and a
 * fast walk keep the right values, and returns at once while the renderer does not draw.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The system `world.ecs.system` takes.
 */
export function createFilterSystem(ectx: EffectsCtx): AnySystem {
  return {
    name: "effects:filters",
    phase: "sync",
    query: [],
    run: (): void => {
      const host = ectx.deps.renderer.host;
      const pixi = host.ready() ? host.pixi() : undefined;

      if (pixi === undefined) return;

      // With no filtered view only the budgets need a look: no change to mark.
      if (ectx.state.views.size === 0) {
        checkBudgets(ectx);
        return;
      }

      markCoreChanges(ectx);

      for (const [entity, view] of ectx.state.views) syncView(ectx, pixi, entity, view);

      checkBudgets(ectx);
    }
  };
}

/**
 * The `onAdded(Kind)` hook, and the sweep of the start: the entity carries the kind now.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The kind.
 * @param entity - The entity.
 */
export function trackFilter(ectx: EffectsCtx, kind: FilterKind, entity: Entity): void {
  const view = ectx.state.views.get(entity) ?? emptyView();

  view.kinds.add(kind.id);
  ectx.state.views.set(entity, view);
}

/**
 * The `onRemoved(Kind)` hook, which a despawn fires too: the kind leaves the view and its
 * instance waits for the next pass, which hands the renderer the new list first and destroys it
 * after. A view that never got an instance is forgotten at once.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The kind.
 * @param entity - The entity.
 */
export function forgetFilter(ectx: EffectsCtx, kind: FilterKind, entity: Entity): void {
  const view = ectx.state.views.get(entity);

  if (view === undefined) return;

  view.kinds.delete(kind.id);

  const instance = view.instances.get(kind.id);

  if (instance !== undefined) {
    view.instances.delete(kind.id);
    view.retired.push(instance);
  }

  const isUnused = view.kinds.size === 0 && view.retired.length === 0 && view.assigned.length === 0;

  if (isUnused) ectx.state.views.delete(entity);
}

/**
 * Retires every `Displacement` whose map is one of `keys`. The next pass assigns the list
 * without it and destroys it; the kind gets a new instance once the map is back.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param keys - The asset keys that left.
 */
export function retireFilterMaps(ectx: EffectsCtx, keys: readonly string[]): void {
  for (const view of ectx.state.views.values()) {
    for (const [id, instance] of view.instances) {
      if (instance.kind !== "displacement" || !keys.includes(instance.map)) continue;

      view.instances.delete(id);
      view.retired.push(instance);
    }
  }
}

/**
 * Takes every filter off every view that holds some and destroys every instance: the teardown,
 * while `renderer` still runs.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function retireAllFilters(ectx: EffectsCtx): void {
  for (const [entity, view] of ectx.state.views) {
    if (view.assigned.length > 0) ectx.deps.renderer.sync.filters.set(entity, Object.freeze([]));

    for (const instance of [...view.instances.values(), ...view.retired]) destroyFilter(instance);
  }

  ectx.state.views.clear();
}
