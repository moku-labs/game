/**
 * @file effects/filters — the `sync` system that keeps one filter instance per view and kind,
 * writes them, hands the sorted list to `renderer.sync.filters.set` only when the kinds, their
 * order or their passes changed, destroys what left, and keeps the two filter budgets. A value
 * write the player can see calls `renderer.invalidate(entity)` first, once per view and frame. It
 * walks the views the world hooks recorded, never the whole world. Its first run with a ready host
 * starts the shader checks; a kind whose check is pending gets no instance, a broken kind its
 * stand-in. A view whose filters declare an `area` gets the union of their areas handed to
 * `renderer.sync.filters.area` when it changes (B4). Once the checks settled, every checked
 * definition and every Pixi-core kind is handed to `renderer.sync.filters.warm` as a probe (F4).
 *
 * Per frame it brings up to date only the views marked dirty: a filter component changed (the change sets of every
 * kind), came or left, a map was retired, a kind still waits for its instance, a chain left places to destroy; a debug
 * switch and a filter that broke or re-ran its chains inside a render mark them all. A frame where nothing of that
 * happened syncs no view and allocates nothing.
 */
import { NineSlice, Shape, Sprite, Transform } from "../../renderer/components";
import type { FilterCache, FilterSlot, PixiModule, ViewportSize } from "../../renderer/types";
import type { AnySystem, Entity } from "../../world/types";
import type { EffectsCtx } from "../types";
import { CORE_CACHE } from "./builtins";
import { kindStatus, pollChecks, startChecks } from "./check";
import {
  createFilter,
  createStandIn,
  createWarmFilter,
  destroyFilter,
  refreshInputs,
  writeFilter
} from "./instance";
import type {
  AreaBox,
  FilterArea,
  FilterDefinition,
  FilteredView,
  FilterFields,
  FilterInstance,
  FilterKind,
  WarmProbe
} from "./types";
import { checksSettled, warmDefinitions } from "./warm";

/** The `before` of a kind a debug switch turned off: it is not drawn, so it asks for no frame. */
const NO_SIGNAL = (): void => {};

/** One of our instances: the kind that may declare an area. */
type OursInstance = Extract<FilterInstance, { kind: "wgsl" }>;

/**
 * The union of a view's areas, computed in place: the sync runs one view at a time, so one scratch box is enough and
 * a frame where an area changed allocates nothing but the tuple it hands over.
 */
const union: AreaBox = { x: 0, y: 0, width: 0, height: 0, some: false };

/**
 * Creates the record of a view with no filter yet. Its change marks, its sorted list and its
 * `signal` are made here once and reused every frame.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param entity - The entity.
 * @returns An empty view.
 */
function emptyView(ectx: EffectsCtx, entity: Entity): FilteredView {
  const marks: number[] = [];

  // A mark per kind from the start, so the array never grows holey.
  for (let index = 0; index < ectx.state.kindList.length; index += 1) marks.push(-1);

  const view: FilteredView = {
    entity,
    kinds: new Set(),
    instances: new Map(),
    retired: [],
    assigned: [],
    marks,
    placed: [],
    signalled: false,
    signal: (): void => {
      if (view.signalled) return;

      view.signalled = true;
      ectx.deps.renderer.invalidate(entity);
    },
    areaSent: { x: 0, y: 0, width: 0, height: 0, some: false },
    areaMask: 0,
    dirty: true,
    gone: false
  };

  return view;
}

/**
 * Marks a view for the next run of the filter sync.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param view - The view's record.
 */
function markDirty(ectx: EffectsCtx, view: FilteredView): void {
  view.dirty = true;
  ectx.state.filterSync.pending = true;
}

/**
 * Logs a warning once per key.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param key - The one-shot key: the line and the kind.
 * @param message - The log message.
 * @param detail - The log detail.
 */
function warnOnce(
  ectx: EffectsCtx,
  key: string,
  message: string,
  detail: Readonly<Record<string, unknown>>
): void {
  if (ectx.state.warned.has(key)) return;

  ectx.state.warned.add(key);
  ectx.log.warn(message, detail);
}

/**
 * Tells whether a value is a finite number.
 *
 * @param value - A field of an area answer.
 * @returns True for a finite number.
 * @example
 * ```ts
 * isFiniteNumber(Number.NaN); // false
 * ```
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tells whether an area answer is four finite numbers whose width and height are at least 0.
 *
 * @param answer - What a definition's `area` answered.
 * @returns True for a usable area.
 * @example
 * ```ts
 * isArea([107, 101, -1, 176]); // false
 * ```
 */
function isArea(answer: unknown): answer is FilterArea {
  if (!Array.isArray(answer) || answer.length !== 4) return false;

  const [x, y, width, height]: readonly unknown[] = answer;

  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    width >= 0 &&
    height >= 0
  );
}

/**
 * Asks an instance's definition for its area at the value it holds, and keeps the answer in place. An area that
 * throws, or answers anything but four finite numbers with a width and a height of at least 0, is logged once per kind
 * and counts as none.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - One of our instances whose value changed.
 */
function judgeArea(ectx: EffectsCtx, instance: OursInstance): void {
  const { area, kindId } = instance;
  const ask = instance.definition.area;
  let answer: unknown;

  instance.areaStale = false;

  try {
    answer = ask?.(instance.value);
  } catch (error) {
    warnOnce(ectx, `area-failed:${kindId}`, "effects:area-failed", { kind: kindId, error });
    answer = undefined;
  }

  if (isArea(answer)) {
    [area.x, area.y, area.width, area.height] = answer;
    area.some = true;

    return;
  }

  if (answer !== undefined) {
    warnOnce(ectx, `bad-area:${kindId}`, "effects:bad-area", { kind: kindId, area: answer });
  }

  area.some = false;
}

/**
 * The union of the areas of a view's enabled filters, into the scratch box: none while no filter is enabled, and none
 * when an enabled filter has no area (every other built-in kind, or a definition that answered `undefined`) — it draws
 * over the view's bounds. An `Alpha` does not count: it only scales the pixels the others draw, and makes none where
 * they draw nothing; alone it leaves the view without an area. A disabled filter, and a kind a debug switch turned off
 * (it is not placed), do not count either.
 *
 * @param view - The view's record, its instances placed.
 */
function unionOf(view: FilteredView): void {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  union.some = false;

  for (const instance of view.placed) {
    if (!instance.filter.enabled || instance.kind === "alpha") continue;
    if (instance.kind !== "wgsl" || !instance.area.some) {
      union.some = false;

      return;
    }

    const { area } = instance;

    union.some = true;
    left = Math.min(left, area.x);
    top = Math.min(top, area.y);
    right = Math.max(right, area.x + area.width);
    bottom = Math.max(bottom, area.y + area.height);
  }

  // None: the numbers are read only for some, and writing the infinite ones would box two numbers per call.
  if (!union.some) return;

  union.x = left;
  union.y = top;
  union.width = right - left;
  union.height = bottom - top;
}

/**
 * Tells whether two areas are the same: both none, or both some with the same four numbers.
 *
 * @param a - One area.
 * @param b - The other.
 * @returns True when nothing has to be handed over.
 */
function sameArea(a: Readonly<AreaBox>, b: Readonly<AreaBox>): boolean {
  if (a.some !== b.some) return false;

  return !a.some || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

/**
 * Keeps the area of one view in step (B4): asks every placed instance whose value changed for its area, and when that,
 * the slot list or an `enabled` switch changed, judges the union again and hands it to the renderer when it differs
 * from what was handed last. On a frame where nothing changed it reads two fields per placed instance. A despawned view
 * gets no call: the renderer forgets the area with its filters.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param entity - The entity.
 * @param view - Its record, its instances placed in draw order.
 * @param relisted - The slot list was handed over again this frame.
 */
function syncArea(ectx: EffectsCtx, entity: Entity, view: FilteredView, relisted: boolean): void {
  let stale = relisted;
  let mask = 0;
  let bit = 1;

  for (const instance of view.placed) {
    if (instance.filter.enabled) mask += bit;
    bit *= 2;

    if (instance.kind === "wgsl" && instance.areaStale) {
      judgeArea(ectx, instance);
      stale = true;
    }
  }

  if (!stale && mask === view.areaMask) return;

  view.areaMask = mask;
  unionOf(view);

  const sent = view.areaSent;

  if (sameArea(union, sent)) return;

  sent.x = union.x;
  sent.y = union.y;
  sent.width = union.width;
  sent.height = union.height;
  sent.some = union.some;

  if (ectx.deps.world.ecs.ownerOf(entity) === undefined) return;

  ectx.deps.renderer.sync.filters.area(
    entity,
    union.some ? [union.x, union.y, union.width, union.height] : undefined
  );
}

/**
 * Marks dirty every view whose filter component of any kind changed this frame, and on it the run in which a
 * Pixi-core kind changed: a core kind is written only in such a run. Reads the change set of each kind.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function markChanges(ectx: EffectsCtx): void {
  const { state, deps } = ectx;
  const { kindList, views } = state;
  const round = state.filterSync.round;

  // per frame: plain arrays only (the kinds, each change set as the world hands it out): `for…of` allocates nothing.
  for (const kind of kindList) {
    for (const entity of deps.world.ecs.changed(kind.component)) {
      const view = views.get(entity);

      if (view === undefined) continue;

      markDirty(ectx, view);
      if (kind.source === "core") view.marks[kind.index] = round;
    }
  }
}

/**
 * Tells whether the instances of a view are in draw order already: by `order`, then by the index of their kind. A
 * view whose orders did not change is, and is not sorted again: a sort copies the list.
 *
 * @param placed - The instances of this frame.
 * @returns True when no pair is out of order.
 */
function inOrder(placed: readonly FilterInstance[]): boolean {
  for (let index = 1; index < placed.length; index += 1) {
    const before = placed[index - 1];
    const after = placed[index];

    if (before !== undefined && after !== undefined && byOrder(before, after) > 0) return false;
  }

  return true;
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
 * instances, another order, other passes, or other stage filters of their inputs.
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
    if (instance.kind === "wgsl" && slot.inputs !== instance.inputs?.slot) return true;
    if (slot.cache !== cacheOfInstance(instance) || slot.blurs !== blursOf(instance)) return true;
  }

  return false;
}

/**
 * What the kept-picture cache may do with an instance (spec 23 P8.4): its definition's category for one of ours (a
 * stand-in's is its fallback's or the dev mark's), the category of the Pixi-core kind otherwise.
 *
 * @param instance - The instance.
 * @returns The category.
 */
function cacheOfInstance(instance: FilterInstance): FilterCache {
  return instance.kind === "wgsl" ? instance.definition.cache : CORE_CACHE[instance.kind];
}

/**
 * Tells whether one of the inputs of a definition starts from the view's own input: its chain draws a copy of the
 * view's subtree. A chain from back draws what was drawn under the view instead.
 *
 * @param definition - The definition.
 * @returns True when one does.
 */
function readsOwnInput(definition: FilterDefinition): boolean {
  const { inputs } = definition;

  // per sync of a changed view: an index over the frozen list; `for…of` over a frozen array allocates its iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- the hot path walks a frozen list by index
  for (let index = 0; index < inputs.length; index += 1) {
    if (inputs[index]?.from === "input") return true;
  }

  return false;
}

/**
 * Whether an instance shows a blurred copy of what is under it (spec 23 P8.5): the built-in `Blur`, or one of ours
 * with an input drawn from its own subtree. A backdrop whose chains start from back blurs the scene under the view,
 * not the view: an overlay holds no loops for it. The predicate an overlay's held loops read (spec 22).
 *
 * @param instance - The instance.
 * @returns True, or `undefined` for every other filter (the slot leaves the key out).
 */
function blursOf(instance: FilterInstance): true | undefined {
  const showsBlur =
    instance.kind === "blur" || (instance.kind === "wgsl" && readsOwnInput(instance.definition));

  return showsBlur ? true : undefined;
}

/**
 * Tells whether a debug switch turned a kind off (`effects.diagnostics.disable`). The guard is
 * inline and positive, so a release build folds the answer to false.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @returns True while the kind is off on a dev or agent page.
 */
function isSwitchedOff(ectx: EffectsCtx, id: string): boolean {
  return (
    ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
      (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) &&
    ectx.state.diagnostics.off.has(id)
  );
}

/**
 * Puts the stand-in a broken instance built while it was drawing in its place: the broken one waits
 * in `retired` and is destroyed after the new list is handed over.
 *
 * @param view - The view's record.
 * @param kind - The kind.
 * @param instance - Its instance now.
 * @returns The instance to keep: the stand-in, or the same instance.
 */
function installReplacement(
  view: FilteredView,
  kind: FilterKind,
  instance: FilterInstance
): FilterInstance {
  const { replacement } = instance;

  if (replacement === undefined) return instance;

  instance.replacement = undefined;
  replacement.entity = instance.entity;
  view.instances.set(kind.id, replacement);
  view.retired.push(instance);

  return replacement;
}

/**
 * Builds the first instance of a kind on a view: nothing while its shader check is pending (the
 * view draws unfiltered, logged once per kind), the stand-in of a broken kind, the kind's own
 * instance once every definition it draws answered ok.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param kind - The kind.
 * @param value - The stored filter value.
 * @returns The instance, or `undefined` while it has none.
 */
function firstInstance(
  ectx: EffectsCtx,
  pixi: PixiModule,
  kind: FilterKind,
  value: Readonly<FilterFields>
): FilterInstance | undefined {
  const status = kindStatus(ectx, kind);

  if (status === "ok") return createFilter(ectx, pixi, kind, value);
  if (status === "broken") return createStandIn(ectx, pixi, kind, value);

  // Never a blank frame: nothing unchecked is drawn. By the gate of the load stage, never on a mounted scene.
  const key = `check-pending:${kind.id}`;

  if (!ectx.state.warned.has(key)) {
    ectx.state.warned.add(key);
    ectx.log.warn("effects:check-pending", { filter: kind.id });
  }

  return undefined;
}

/**
 * Brings one kind of one view up to date: the first frame it is seen it gets its instance, once
 * its shader check answered (its stand-in when the kind is broken), which reaches the renderer
 * through the new slot list; after that it is written, its chains run again when a uniform changed,
 * and a visible write asks the renderer for the frame first. A stand-in a broken instance built
 * takes its place. A kind a debug switch turned off is written but asks for nothing.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param entity - The entity.
 * @param view - Its record.
 * @param kind - The kind.
 * @param changed - Whether its component changed this frame.
 * @param off - Whether a debug switch turned the kind off.
 * @returns The instance, its `order` up to date, or `undefined` while it has none.
 */
function syncKind(
  ectx: EffectsCtx,
  pixi: PixiModule,
  entity: Entity,
  view: FilteredView,
  kind: FilterKind,
  changed: boolean,
  off: boolean
): FilterInstance | undefined {
  const value = ectx.deps.world.ecs.get(entity, kind.component);

  if (value === undefined) return undefined;

  let instance = view.instances.get(kind.id);

  if (instance !== undefined) {
    instance = installReplacement(view, kind, instance);
    instance.value = value;
    writeFilter(ectx, instance, value, changed, off ? NO_SIGNAL : view.signal);
    instance.order = value.order;
    refreshInputs(ectx, pixi, instance, off);

    // Places a chain left in this sync are destroyed by the next one; an `Alpha` counting its syncs at rest is synced
    // again, so a fade that ends at 1 lets its pass go on a still screen too.
    if (
      (instance.kind === "wgsl" && (instance.inputs?.retired.length ?? 0) > 0) ||
      (instance.kind === "alpha" && instance.calm > 0)
    ) {
      markDirty(ectx, view);
    }

    // A chain that broke in this sync built its stand-in: it takes the place now.
    return installReplacement(view, kind, instance);
  }

  instance = firstInstance(ectx, pixi, kind, value);

  if (instance === undefined) return undefined;

  instance.entity = entity;

  // A chain that broke at its first evaluation built its stand-in already.
  instance = installReplacement(view, kind, instance);
  view.instances.set(kind.id, instance);

  return instance;
}

/**
 * The slot of one instance: its filter, its passes, its kind id for the performance log, the
 * seam of its inputs when it has some, and what the kept-picture cache may do with it (its
 * category, a placed filter's origin, whether it shows a blurred copy).
 *
 * @param instance - The instance.
 * @returns The slot.
 */
function slotOf(instance: FilterInstance): FilterSlot {
  const cache = cacheOfInstance(instance);
  const slot: FilterSlot = {
    filter: instance.filter,
    passes: instance.passes,
    kind: instance.kindId,
    cache
  };

  if (instance.kind === "wgsl" && instance.inputs !== undefined) slot.inputs = instance.inputs.slot;
  if (blursOf(instance)) slot.blurs = true;

  // A placed filter hands over its `keptOrigin` by reference, once: the renderer writes it in place.
  if (cache === "placed" && instance.kind === "wgsl") {
    const origin = instance.group?.uniforms.keptOrigin;

    if (origin instanceof Float32Array) slot.origin = origin;
  }

  return slot;
}

/**
 * Brings every kind of a view up to date and collects the instances it has, in kind order, into the view's own list.
 * A kind with no instance yet (its check pending, its map not loaded) keeps the view dirty, so the next run asks
 * again; a kind a debug switch turned off is written and left out of the list.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param view - The view's record.
 */
function placeKinds(ectx: EffectsCtx, pixi: PixiModule, view: FilteredView): void {
  const { placed, entity } = view;
  const round = ectx.state.filterSync.round;

  // per sync: emptied by `pop`, so the array keeps its store (a cut with `length = 0` gives it up).
  while (placed.length > 0) placed.pop();
  view.signalled = false;

  for (const id of view.kinds) {
    const kind = ectx.state.kinds.get(id);
    const changed = kind !== undefined && view.marks[kind.index] === round;
    const off = isSwitchedOff(ectx, id);
    const instance =
      kind === undefined ? undefined : syncKind(ectx, pixi, entity, view, kind, changed, off);

    if (instance === undefined) markDirty(ectx, view);
    else if (!off) placed.push(instance);
  }
}

/**
 * Brings one view up to date, hands the renderer a new frozen slot list when it differs, then
 * destroys what left. A view with nothing left is forgotten; a despawned one gets no call, since
 * the renderer cleared its view when it released it. A kind that still has no instance (its check
 * pending, its map not loaded) keeps the view dirty, so the next run asks again.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param view - The view's record.
 */
function syncView(ectx: EffectsCtx, pixi: PixiModule, view: FilteredView): void {
  const { placed, entity } = view;

  placeKinds(ectx, pixi, view);

  // Hand the renderer a new frozen list only when the sorted instances changed; a sort only when an order did.
  if (!inOrder(placed)) placed.sort(byOrder);

  const relisted = differs(view.assigned, placed);

  if (relisted) {
    const slots = placed.map(instance => slotOf(instance));

    // A despawned entity gets no call: the renderer forgot its slots when it let the view go.
    const needsSet = slots.length > 0 || ectx.deps.world.ecs.ownerOf(entity) !== undefined;

    if (needsSet) ectx.deps.renderer.sync.filters.set(entity, Object.freeze(slots));

    view.assigned = slots;
  }

  // The area of the enabled filters, judged again only when a value, the list or a switch changed (B4).
  syncArea(ectx, entity, view, relisted);

  // Destroy what left only now, after the renderer stopped drawing it.
  if (view.retired.length > 0) {
    for (const retired of view.retired.splice(0)) destroyFilter(retired);
  }

  // Forget a view with nothing left on it.
  if (view.kinds.size === 0 && view.instances.size === 0) forgetView(ectx, view);
}

/**
 * Forgets a view: out of `State.views` now, out of the dense list at the next run, which skips it.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param view - The view's record.
 */
function forgetView(ectx: EffectsCtx, view: FilteredView): void {
  view.gone = true;
  view.dirty = false;
  ectx.state.views.delete(view.entity);
  // The next run walks the list to drop it.
  ectx.state.filterSync.pending = true;
}

/**
 * Syncs the views marked dirty, in the order they were first seen, and drops the forgotten ones from the dense list
 * in the same walk (written back in place by a second index, no new array).
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @returns True when a view was synced or dropped: the full-screen budget is judged again.
 */
function syncDirty(ectx: EffectsCtx, pixi: PixiModule): boolean {
  const list = ectx.state.viewList;
  const sync = ectx.state.filterSync;
  let kept = 0;
  let moved = false;

  // per frame: nothing marked, nothing forgotten — the list is not walked at all.
  if (!sync.pending) return false;

  // A view the walk marks again (a kind still waiting) sets it for the next run.
  sync.pending = false;

  // per frame: an indexed walk over the dense list; a clean view costs one flag read.
  for (let index = 0; index < list.length; index += 1) {
    const view = list[index];

    if (view === undefined) continue;

    if (view.dirty && !view.gone) {
      view.dirty = false;
      moved = true;
      syncView(ectx, pixi, view);
    }

    if (view.gone) {
      moved = true;
      continue;
    }

    list[kept] = view;
    kept += 1;
  }

  while (list.length > kept) list.pop();

  return moved;
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
 * Tells whether a filtered view covers the whole viewport. A view whose enabled filters declare an
 * area draws only there: that area, times the view's scale, covers the reference size on both axes
 * (F43, a lens over a full-screen sprite is not full screen). Otherwise the box its sprite, its
 * nine-slice or its shape declares, times its scale, does. A sprite without a size declares none.
 * Read from components and the area handed over last, never from Pixi bounds.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param view - The view's record.
 * @param size - The viewport size.
 * @returns True for a full-screen view.
 */
function coversScreen(ectx: EffectsCtx, view: FilteredView, size: ViewportSize): boolean {
  const { entity, areaSent } = view;

  if (areaSent.some) return boxCovers(ectx, entity, areaSent.width, areaSent.height, size);

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
 * Tells whether a view has at least one enabled filter instance that is drawn: a kind a debug
 * switch turned off is not.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param view - The view.
 * @returns True when one of its drawn instances is enabled.
 */
function hasEnabledFilter(ectx: EffectsCtx, view: FilteredView): boolean {
  // Walk the kind ids, a Set, rather than the instances' entries, which build a pair per item.
  for (const id of view.kinds) {
    if (view.instances.get(id)?.filter.enabled === true && !isSwitchedOff(ectx, id)) return true;
  }

  return false;
}

/**
 * Frames in a row the render passes stay over the budget before it warns. A scene that appears draws every filtered
 * view live until its first take, one take a frame, and a take frame pays the take on top of the views still live: a
 * board of A Memory Missing went 26 of 24 for a few frames on a cold start (F117). A second at 60 Hz outlasts that.
 */
const STEADY_FRAMES = 60;

/**
 * Warns once per steady crossing of the pass budget: the renderer's render passes over `config.maxPasses` for
 * `STEADY_FRAMES` frames in a row. The count walks the renderer's filtered views, so it is read only while a view
 * carries a filter; with none the frame draws at most one pass and the budget cannot trip.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function checkPassBudget(ectx: EffectsCtx): void {
  const { state, config, deps } = ectx;

  // No filtered view: at most one pass, under any budget.
  if (state.views.size === 0) {
    state.over.passes = 0;

    return;
  }

  const passes = deps.renderer.sync.renderPasses();

  if (passes <= config.maxPasses) {
    state.over.passes = 0;

    return;
  }

  state.over.passes += 1;

  // Warn once, in the frame the crossing becomes steady.
  if (state.over.passes === STEADY_FRAMES) {
    ectx.log.warn("effects:pass-budget", { passes, budget: config.maxPasses });
  }
}

/** The components a view's box and scale are read from (`coversScreen`): one plain array, never frozen. */
const BOX_COMPONENTS = [Transform, Sprite, NineSlice, Shape] as const;

/**
 * Tells whether the box or the scale of a filtered view changed this frame.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns True when a change set of `Transform`, `Sprite`, `NineSlice` or `Shape` holds a filtered view.
 */
function boxesChanged(ectx: EffectsCtx): boolean {
  const { views } = ectx.state;
  const ecs = ectx.deps.world.ecs;

  for (const component of BOX_COMPONENTS) {
    for (const entity of ecs.changed(component)) if (views.has(entity)) return true;
  }

  return false;
}

/**
 * Counts the views that cover the viewport with an enabled filter, over the dense list.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param size - The viewport size.
 * @returns The count.
 */
function countFullScreen(ectx: EffectsCtx, size: ViewportSize): number {
  let count = 0;

  for (const view of ectx.state.viewList) {
    if (view.gone) continue;
    if (hasEnabledFilter(ectx, view) && coversScreen(ectx, view, size)) count += 1;
  }

  return count;
}

/**
 * Warns once per crossing of each filter budget: the renderer's render passes over
 * `config.maxPasses`, read every frame, and more than one full-screen view with an enabled filter,
 * judged again only when a view was synced or dropped, the viewport changed size, or the box or the
 * scale of a filtered view changed; otherwise the last judgement stands.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param moved - A view was synced or dropped this run.
 */
function checkBudgets(ectx: EffectsCtx, moved: boolean): void {
  const { state, deps } = ectx;
  const sync = state.filterSync;

  checkPassBudget(ectx);

  const size = deps.renderer.viewport.size();
  const resized = size.width !== sync.width || size.height !== sync.height;

  if (!moved && !resized && !boxesChanged(ectx)) return;

  sync.width = size.width;
  sync.height = size.height;

  // The full-screen budget: count the views that cover the viewport with an enabled filter.
  const count = countFullScreen(ectx, size);

  // Warn once when more than one such view is on screen.
  const overScreen = count > 1;

  if (overScreen && !state.over.fullScreen) {
    ectx.log.warn("effects:full-screen-filters", { count });
  }

  state.over.fullScreen = overScreen;
}

/**
 * Takes a probe out of the warm-up and destroys it: the renderer had nothing to warm.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param probe - The probe.
 */
function dropProbe(ectx: EffectsCtx, probe: WarmProbe): void {
  const { probes } = ectx.state.warm;
  const at = probes.indexOf(probe);

  if (at === -1) return;

  probes.splice(at, 1);
  probe.destroy();
}

/**
 * A probe of one Pixi-core kind at the frozen defaults of its component; a `Displacement` draws over Pixi's white
 * texture, since its program does not depend on the map. A probe is switched on whatever its defaults: an `Alpha` at 1
 * would be off, and Pixi would warm nothing. Its `apply` is guarded like any instance's.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param id - The kind id.
 * @returns The probe, or `undefined` for a kind that is gone.
 */
function coreProbe(ectx: EffectsCtx, pixi: PixiModule, id: string): WarmProbe | undefined {
  const kind = ectx.state.kinds.get(id);
  const instance =
    kind === undefined
      ? undefined
      : createFilter(ectx, pixi, kind, kind.component.defaults, pixi.Texture.WHITE);

  if (instance === undefined) return undefined;

  instance.filter.enabled = true;

  return { filter: instance.filter, destroy: (): void => destroyFilter(instance) };
}

/**
 * The probes of the warm-up, built one at a time in hand-over order: every Pixi-core kind, then every definition
 * `warmDefinitions` lists (the body of every ready kind, every stage of its inputs, every checked fallback), each in
 * its own order. A core kind goes first: when the renderer has nothing to warm, the one probe built to learn it is one
 * of Pixi's own filters, and no program of a game's shader is compiled for nothing.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @yields {WarmProbe} One probe, built as it is asked for.
 */
function* probesOf(ectx: EffectsCtx, pixi: PixiModule): Generator<WarmProbe> {
  for (const id of ectx.state.warm.core) {
    const probe = coreProbe(ectx, pixi, id);

    if (probe !== undefined) yield probe;
  }

  for (const entry of warmDefinitions(ectx)) yield createWarmFilter(pixi, entry.definition);
}

/**
 * Hands one probe to `renderer.sync.filters.warm` and keeps it; a probe the renderer answers false for is destroyed.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param probe - The probe.
 * @returns The renderer's answer: true once the probe was warmed, false when there is nothing to warm.
 */
function handProbe(ectx: EffectsCtx, probe: WarmProbe): Promise<boolean> {
  const answer = ectx.deps.renderer.sync.filters.warm(probe.filter);

  ectx.state.warm.probes.push(probe);
  answer.then(warmed => {
    if (!warmed) dropProbe(ectx, probe);
  });

  return answer;
}

/**
 * The answer of the first probe if it is given already, `"pending"` while it is not. "Nothing to warm" is an answer
 * already given; a warm-up answers frames later.
 *
 * @param answer - The renderer's answer for the first probe.
 * @returns Resolves to the answer when it was settled, otherwise to `"pending"`.
 */
function answerNow(answer: Promise<boolean>): Promise<boolean | "pending"> {
  return Promise.race([answer, Promise.resolve("pending" as const)]);
}

/**
 * Hands every probe to `renderer.sync.filters.warm`, once the checks of this run settled. The probes live until the app
 * stops (the renderer warms them again after a restore). A probe the renderer answers false for is destroyed: there is
 * nothing to warm, which it answers at once, so after a first answer of false no later probe is built.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 * @param run - The check run the hand-over belongs to: a run that stopped meanwhile hands nothing over.
 * @returns Resolves when every probe was handed over.
 */
async function handOver(ectx: EffectsCtx, pixi: PixiModule, run: number): Promise<void> {
  const { warm } = ectx.state;

  if (ectx.state.checks.run !== run || !warm.started) return;

  const probes = probesOf(ectx, pixi);
  const first = probes.next();

  if (first.done === true) return;
  if ((await answerNow(handProbe(ectx, first.value))) === false) return;
  if (ectx.state.checks.run !== run || !warm.started) return;

  for (const probe of probes) handProbe(ectx, probe);
}

/**
 * Starts the warm-up hand-over at the first frame with a ready host (F4): notes the Pixi-core kinds, in registration
 * order, and, off the frame path, once every shader check of this run answered, hands the probes over.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 */
function startWarm(ectx: EffectsCtx, pixi: PixiModule): void {
  const { warm, checks } = ectx.state;
  const run = checks.run;

  warm.started = true;
  warm.core = [];

  for (const kind of ectx.state.kinds.values()) if (kind.source === "core") warm.core.push(kind.id);

  checksSettled(ectx).then(() => handOver(ectx, pixi, run));
}

/**
 * One run of the filter sync with a ready host: the change marks of this run, the dirty views, the budgets. With no
 * filtered view only the budgets need a look, and the dense list lets go of the records it still held.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param pixi - The module the renderer loaded.
 */
function runSync(ectx: EffectsCtx, pixi: PixiModule): void {
  const { state } = ectx;
  const sync = state.filterSync;

  if (state.views.size === 0) {
    while (state.viewList.length > 0) state.viewList.pop();
    checkBudgets(ectx, true);

    return;
  }

  sync.round += 1;

  if (sync.all) {
    sync.all = false;
    for (const view of state.viewList) markDirty(ectx, view);
  }

  markChanges(ectx);
  checkBudgets(ectx, syncDirty(ectx, pixi));
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

      // The shader checks start at the first frame with a ready host, whatever is on screen.
      if (!ectx.state.checks.started) startChecks(ectx);
      // So does the warm-up: its probes go to the renderer once the checks settled.
      if (!ectx.state.warm.started) startWarm(ectx, pixi);
      if (ectx.state.checks.gl.length > 0) pollChecks(ectx);

      runSync(ectx, pixi);
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
  let view = ectx.state.views.get(entity);

  if (view === undefined) {
    view = emptyView(ectx, entity);
    ectx.state.views.set(entity, view);
    ectx.state.viewList.push(view);
  }

  view.kinds.add(kind.id);
  markDirty(ectx, view);
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
  markDirty(ectx, view);

  const instance = view.instances.get(kind.id);

  if (instance !== undefined) {
    view.instances.delete(kind.id);
    view.retired.push(instance);
  }

  const isUnused = view.kinds.size === 0 && view.retired.length === 0 && view.assigned.length === 0;

  if (isUnused) forgetView(ectx, view);
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
      markDirty(ectx, view);
    }
  }
}

/**
 * Takes every filter and filter area off every view that holds some, destroys every instance and every probe of the
 * warm-up: the teardown, while `renderer` still runs.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function retireAllFilters(ectx: EffectsCtx): void {
  const { filters } = ectx.deps.renderer.sync;

  for (const [entity, view] of ectx.state.views) {
    if (view.assigned.length > 0) filters.set(entity, Object.freeze([]));
    // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` sends the view back to its bounds; it is not optional.
    if (view.areaSent.some) filters.area(entity, undefined);

    for (const instance of [...view.instances.values(), ...view.retired]) destroyFilter(instance);
  }

  ectx.state.views.clear();
  while (ectx.state.viewList.length > 0) ectx.state.viewList.pop();

  const { warm } = ectx.state;

  for (const probe of warm.probes.splice(0)) probe.destroy();
  warm.started = false;
  warm.core = [];
}
