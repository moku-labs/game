/**
 * @file renderer/sync — the overlay step: which views an overlay keeps as one picture or covers, its dim and the HUD
 * parts it fades, all written in one step of the render phase, after every writer of the frame and before the
 * decision (spec 22 O5–O10). A game without an overlay and a HUD part pays one size check.
 */
import type { Entity } from "../../world/types";
import { HudPart, Overlay, OverlayLevel, type OverlayValue } from "../components";
import type { OverlayEventDetail, PixiContainer, PixiModule } from "../types";
import { stepDims, stepParts } from "./overlay-look";
import { clearRange, rangeHolds, stepRange } from "./overlay-range";
import { isLeaving, parentOf } from "./pose";
import type {
  ActiveRange,
  OverlayEventSink,
  OverlayMode,
  OverlayPhase,
  OverlayRecord,
  OverlayReport,
  OverlayState,
  SyncCtx
} from "./types";

/** How deep a `Parent` chain or a walk up the tree goes. */
const MAX_DEPTH = 32;

/** The owner `ui` gives the entities it spawns: the only overlays honoured (O4.8). */
const UI_OWNER_NAME = "ui";

/**
 * Logs one warning once per code and entity, in dev builds.
 *
 * @param sctx - Domain context of the sync module.
 * @param code - The log event, also the key of the once-rule with the entity.
 * @param entity - The entity it is about.
 * @param data - The fields of the line.
 */
function warnOnce(
  sctx: SyncCtx,
  code: string,
  entity: Entity,
  data: Readonly<Record<string, unknown>>
): void {
  if (!(typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__)) return;

  const warned = sctx.ctx.state.sync.overlay.warned;
  const key = `${code}:${entity}`;

  if (warned.has(key)) return;

  warned.add(key);
  sctx.ctx.log.warn(code, { entity, ...data });
}

/**
 * Tells whether a value is a list of strings: the shape of a `hud` key list.
 *
 * @param value - The value of `hud`.
 * @returns True for an array of strings.
 * @example
 * ```ts
 * isKeyList(["energy", "gems"]); // true
 * ```
 */
function isKeyList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/**
 * Copies the marker into the record's own value, clamped (O1): `dim` into [0, 1], `fade` to 0 or more, an unknown
 * `cover` as `"none"`, a `hud` that is not `"all"`, `"none"` or a key list as `"all"`; one dev warning per field.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The marked entity.
 * @param into - The record's value.
 * @param raw - The marker as the entity carries it.
 */
function clampInto(
  sctx: SyncCtx,
  entity: Entity,
  into: OverlayValue,
  raw: Readonly<OverlayValue>
): void {
  const dim = Number.isFinite(raw.dim) ? Math.min(1, Math.max(0, raw.dim)) : 0;
  const fade = Number.isFinite(raw.fade) ? Math.max(0, raw.fade) : 0;
  const cover = raw.cover === "opaque" ? "opaque" : "none";
  const hud = raw.hud === "all" || raw.hud === "none" || isKeyList(raw.hud) ? raw.hud : "all";

  if (dim !== raw.dim) warnOnce(sctx, "renderer:overlay-value", entity, { field: "dim" });
  if (fade !== raw.fade) warnOnce(sctx, "renderer:overlay-value", entity, { field: "fade" });
  if (cover !== raw.cover) warnOnce(sctx, "renderer:overlay-value", entity, { field: "cover" });
  if (hud !== raw.hud) warnOnce(sctx, "renderer:overlay-value", entity, { field: "hud" });

  into.dim = dim;
  into.dimColor = Number.isFinite(raw.dimColor) ? raw.dimColor : 0;
  into.cover = cover;
  into.hud = hud;
  into.fade = fade;
}

/**
 * The root of an entity's `Parent` chain, depth-bounded.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The marked entity.
 * @returns The entity with no parent.
 */
function rootOf(sctx: SyncCtx, entity: Entity): Entity {
  const ecs = sctx.ctx.deps.world.ecs;
  let current = entity;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = parentOf(ecs, current);

    if (parent === 0) return current;

    current = parent;
  }

  return current;
}

/**
 * Where a root's top hangs: its layer and the layer's index in the scene's list.
 *
 * @param sctx - Domain context of the sync module.
 * @param container - The parent of the root's top.
 * @returns The layer name and index, and the index of the HUD layer (-1 without one); `undefined` for an orphan.
 */
function layerSlotOf(
  sctx: SyncCtx,
  container: PixiContainer | null
): { name: string; index: number; hud: number } | undefined {
  const state = sctx.ctx.state.sync;
  const list = state.layerList ?? [];
  let found: { name: string; index: number } | undefined;
  let hud = -1;

  for (const [index, spec] of list.entries()) {
    if (spec.above === "overlays") hud = index;
    if (container !== null && state.layers.get(spec.name)?.container === container) {
      found = { name: spec.name, index };
    }
  }

  return found === undefined ? undefined : { ...found, hud };
}

/**
 * A new record for an overlay that appeared this frame.
 *
 * @param entity - The marked entity.
 * @param object - Its root's top object.
 * @param container - The layer container the root hangs in.
 * @returns The record, entering, live, with no dim.
 */
function createRecord(
  entity: Entity,
  object: PixiContainer,
  container: PixiContainer
): OverlayRecord {
  return {
    entity,
    label: "",
    top: entity,
    object,
    container,
    layer: "",
    layerIndex: 0,
    value: { ...Overlay.defaults },
    level: 0,
    phase: "entering",
    turned: undefined,
    mode: "live",
    dim: undefined,
    sized: false,
    seen: false,
    news: "open"
  };
}

/**
 * The phase of an overlay: leaving wins, then landed. Pure.
 *
 * @param leaving - The overlay or an ancestor carries `Exiting`.
 * @param landed - Its enter motion is over.
 * @returns The phase.
 * @example
 * ```ts
 * phaseOf(false, true); // "shown"
 * ```
 */
function phaseOf(leaving: boolean, landed: boolean): OverlayPhase {
  if (leaving) return "exiting";

  return landed ? "shown" : "entering";
}

/**
 * Finds and updates the record of one marked entity (O5.2): a ui element whose root hangs in a layer under the HUD
 * layer; its marker clamped, its level and its phase read. The record waits while the root has no view or hangs in no
 * layer. A new record notes `"open"`, a phase turned `"landed"` or `"leave"`.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The marked entity.
 */
function seeOverlay(sctx: SyncCtx, entity: Entity): void {
  const state = sctx.ctx.state.sync;
  const ecs = sctx.ctx.deps.world.ecs;
  const owner = ecs.ownerOf(entity);

  // Only a ui element is an overlay.
  if (owner?.kind !== "plugin" || owner.name !== UI_OWNER_NAME) {
    warnOnce(sctx, "renderer:overlay-ignored", entity, { reason: "not a ui element" });

    return;
  }

  // Its root's view and the layer that view hangs in: the record waits until both are there.
  const top = rootOf(sctx, entity);
  const view = state.views.get(top);
  const raw = ecs.get(entity, Overlay);

  if (view === undefined || raw === undefined) return;

  const object = view.wrapper ?? view.object;
  const slot = layerSlotOf(sctx, object.parent);

  if (slot === undefined || object.parent === null) return;

  // An overlay in or above the HUD layer is refused: the HUD stays over every overlay.
  if (slot.hud !== -1 && slot.index >= slot.hud) {
    warnOnce(sctx, "renderer:overlay-above-hud", entity, { layer: slot.name });

    return;
  }

  // The record, found or made: its place, its level and its phase read again, a turn noted.
  const known = state.overlay.records.get(entity);
  const record = known ?? createRecord(entity, object, object.parent);
  const level = ecs.get(entity, OverlayLevel);
  const phase = phaseOf(isLeaving(ecs, entity), level?.landed === true);

  state.overlay.records.set(entity, record);
  record.label = state.views.get(entity)?.object.label ?? record.label;
  record.top = top;
  record.object = object;
  record.container = object.parent;
  record.layer = slot.name;
  record.layerIndex = slot.index;
  record.level = Math.min(1, Math.max(0, level?.level ?? 0));
  // A new record opens in whatever phase it is found in; a known one notes the turn.
  const turned = known === undefined || phase === record.phase ? undefined : phase;

  record.turned = turned;
  if (turned !== undefined) record.news = turned === "exiting" ? "leave" : "landed";
  record.phase = phase;
  record.seen = true;
  clampInto(sctx, entity, record.value, raw);
}

/**
 * Queues one `overlay` event line of an agent build.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @param what - What happened.
 * @param mode - Its mode now.
 */
function note(
  sctx: SyncCtx,
  record: OverlayRecord,
  what: OverlayEventDetail["what"],
  mode: OverlayMode
): void {
  if (!(typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) return;

  sctx.ctx.state.sync.overlay.events.push({
    entity: record.entity,
    label: record.label,
    what,
    mode
  });
}

/**
 * Drops a record whose entity lost `Overlay` or its view: its dim goes in this frame, `"gone"` is noted.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay that left.
 */
function dropRecord(sctx: SyncCtx, record: OverlayRecord): void {
  if (record.dim !== undefined) {
    sctx.deps.demand.whole("overlay");
    if (!record.dim.destroyed) record.dim.destroy();
    record.dim = undefined;
  }

  note(sctx, record, "gone", modeReported(sctx.ctx.state.sync.overlay, record));
  sctx.ctx.state.sync.overlay.records.delete(record.entity);
}

/**
 * The rank of a record: layer, then depth, then insertion in its layer container, the order Pixi draws them in.
 *
 * @param left - One record.
 * @param right - The other.
 * @returns Below 0 when `left` draws first.
 */
function compareRank(left: OverlayRecord, right: OverlayRecord): number {
  if (left.layerIndex !== right.layerIndex) return left.layerIndex - right.layerIndex;
  if (left.object.zIndex !== right.object.zIndex) return left.object.zIndex - right.object.zIndex;

  return left.container.getChildIndex(left.object) - right.container.getChildIndex(right.object);
}

/**
 * Fills `order` with the records bottom first: an insertion sort on the reused array.
 *
 * @param overlay - The overlay state.
 */
function sortOrder(overlay: OverlayState): void {
  const { order } = overlay;

  order.length = 0;

  for (const record of overlay.records.values()) {
    let at = order.length;

    while (at > 0) {
      const before = order[at - 1];

      if (before === undefined || compareRank(before, record) <= 0) break;

      order[at] = before;
      at -= 1;
    }

    order[at] = record;
  }
}

/**
 * The alpha a set of filters multiplies by: every enabled `AlphaFilter` among them.
 *
 * @param filters - The filters of a node, or none.
 * @param alphaFilter - Pixi's `AlphaFilter` class.
 * @returns The product of their alphas, 1 with none.
 */
function alphaOfFilters(
  filters: readonly unknown[] | null | undefined,
  alphaFilter: PixiModule["AlphaFilter"] | undefined
): number {
  if (filters === null || filters === undefined || alphaFilter === undefined) return 1;

  let alpha = 1;

  for (const filter of filters) {
    if (filter instanceof alphaFilter && filter.enabled) alpha *= filter.alpha;
  }

  return alpha;
}

/**
 * The alpha the marked view is drawn with (O5.3): the product of the alphas up to the stage root, times every enabled
 * `AlphaFilter` on the way; the filters of a view's top are read where they hang now (a kept view's stand-in). 0 when
 * a node is not visible.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @returns The drawn alpha.
 */
function drawnAlpha(sctx: SyncCtx, record: OverlayRecord): number {
  const state = sctx.ctx.state.sync;
  const view = state.views.get(record.entity);
  const root = state.root;

  if (view === undefined || root === undefined) return 0;

  const alphaFilter = sctx.deps.host.pixi()?.AlphaFilter;
  let alpha = 1;
  let node: PixiContainer | null = view.wrapper ?? view.object;

  for (let depth = 0; depth < MAX_DEPTH && node !== null; depth += 1) {
    if (node === root) return alpha;
    if (!node.visible) return 0;

    const owner = state.viewOfTop.get(node);
    const filters = owner === undefined ? node.filters : sctx.deps.kept.filterTarget(owner).filters;

    alpha *= node.alpha * alphaOfFilters(filters, alphaFilter);
    node = node.parent;
  }

  return 0;
}

/**
 * The mode of one overlay (O5.3): an opaque one covers once it has landed, is not leaving and is drawn at alpha 1, and
 * is live from its first exit frame; everything else keeps a picture.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @returns Its mode.
 */
function modeOf(sctx: SyncCtx, record: OverlayRecord): OverlayMode {
  if (record.value.cover === "opaque") {
    if (record.phase === "exiting") return "live";
    if (record.phase === "shown" && drawnAlpha(sctx, record) >= 1) return "cover";
  }

  return "freeze";
}

/**
 * The mode `debug.overlays()` and the event lines report: the owner's mode while its range is hidden or kept, `"live"`
 * for every overlay that owns no range and for a range drawn live.
 *
 * @param overlay - The overlay state.
 * @param record - The overlay.
 * @returns The reported mode.
 */
function modeReported(overlay: OverlayState, record: OverlayRecord): OverlayMode {
  return ownedRange(overlay, record)?.mode ?? "live";
}

/**
 * The range an overlay owns and keeps hidden or as a picture now (not drawn live).
 *
 * @param overlay - The overlay state.
 * @param record - The overlay.
 * @returns The range held now when this overlay owns it and its entries carry a reason; `undefined` otherwise.
 */
function ownedRange(overlay: OverlayState, record: OverlayRecord): ActiveRange | undefined {
  const range = overlay.active;

  return range !== undefined && range.owner === record.entity && range.reason !== undefined
    ? range
    : undefined;
}

/**
 * Tells whether the overlay step has nothing to do: no marked entity, no HUD part, no record and no range held.
 *
 * @param overlay - The overlay state.
 * @returns True when the step can return at once.
 */
function overlaysIdle(overlay: OverlayState): boolean {
  return (
    overlay.entities.size === 0 &&
    overlay.parts.size === 0 &&
    overlay.records.size === 0 &&
    overlay.active === undefined
  );
}

/**
 * The overlay step of the render phase (the body of `SyncInternal.stepOverlays`): the records, their order and modes,
 * the dims, the range with its reasons and its picture, and the HUD parts, in that order. New layers let the range go
 * first; it is built again from the new layers in the same step.
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepOverlays(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;

  if (state.root === undefined || overlaysIdle(overlay)) return;

  const wholes = sctx.deps.demand.wholes();

  overlay.flipped.clear();
  if (wholes.has("layers")) clearRange(sctx);

  for (const record of overlay.records.values()) record.seen = false;
  for (const entity of overlay.entities) seeOverlay(sctx, entity);
  for (const record of overlay.records.values()) if (!record.seen) dropRecord(sctx, record);

  sortOrder(overlay);
  for (const record of overlay.order) record.mode = modeOf(sctx, record);

  stepDims(sctx, wholes);
  stepRange(sctx, wholes);

  for (const record of overlay.order) {
    if (record.news !== undefined) note(sctx, record, record.news, modeReported(overlay, record));
    record.news = undefined;
  }

  stepParts(sctx);
  overlay.left = false;
}

/**
 * Whether the endless cosmetic loops of an entity write nothing now: the overlay cases of `SyncApi.loopsHeld` (spec 26
 * adds the unseen ones). One check while no range is held.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity a loop is about to write.
 * @returns True when the write would change nothing the player sees.
 */
export function loopsHeld(sctx: SyncCtx, entity: Entity): boolean {
  return rangeHolds(sctx.ctx.state.sync, entity);
}

/**
 * The overlays as `debug.overlays()` reports them, bottom first, as a fresh array.
 *
 * @param sctx - Domain context of the sync module.
 * @returns One report per overlay.
 */
export function overlayReports(sctx: SyncCtx): readonly OverlayReport[] {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;

  if (state.root === undefined) return [];

  return overlay.order.map(record => {
    const owned = ownedRange(overlay, record);

    return {
      entity: record.entity,
      label: record.label,
      phase: record.phase,
      mode: owned?.mode ?? "live",
      level: record.level,
      range: owned?.entries.length ?? 0,
      kept: owned !== undefined && sctx.deps.kept.kept(record.entity)
    };
  });
}

/**
 * Hands the queued `overlay` lines to the monitor, oldest first, and forgets them.
 *
 * @param sctx - Domain context of the sync module.
 * @param monitor - The monitor's event writer.
 */
export function drainOverlayEvents(sctx: SyncCtx, monitor: OverlayEventSink): void {
  const { events } = sctx.ctx.state.sync.overlay;

  if (events.length === 0) return;

  for (const detail of events) monitor.event("overlay", detail);

  events.length = 0;
}

/**
 * Watches the two components of the step: the entities that carry `Overlay` and `HudPart`, the ones there already
 * included.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The removers of the four hooks.
 */
export function watchOverlays(sctx: SyncCtx): Array<() => void> {
  const overlay = sctx.ctx.state.sync.overlay;
  const ecs = sctx.ctx.deps.world.ecs;

  for (const [entity] of ecs.query(Overlay)) overlay.entities.add(entity);
  for (const [entity] of ecs.query(HudPart)) overlay.parts.add(entity);

  return [
    ecs.onAdded(Overlay, entity => overlay.entities.add(entity)),
    ecs.onRemoved(Overlay, entity => overlay.entities.delete(entity)),
    ecs.onAdded(HudPart, entity => overlay.parts.add(entity)),
    ecs.onRemoved(HudPart, entity => overlay.parts.delete(entity))
  ];
}
