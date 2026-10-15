/**
 * @file renderer/sync — the one range an overlay keeps or covers (O5.4–O5.5, O8): which nodes are drawn before the
 * owner's root, the reason written on them, the picture handed to `kept` and when it is taken again. Every write is a
 * difference with the last frame, in one step: the picture is asked for before its `"freeze"` reasons, a new reason is
 * written before the old one comes off, so no stage pass shows the range neither live nor as a current picture (K3).
 */
import type { Entity } from "../../world/types";
import type { DemandReason } from "../demand/types";
import type { KeptRange } from "../kept/types";
import type { PixiContainer } from "../types";
import { type HiddenReason, hiddenBy, setHidden, setLayerHidden, setObjectHidden } from "./hidden";
import type { ActiveRange, FilterSlot, OverlayRecord, SyncCtx, SyncState, View } from "./types";

/** A range retaken for a mark in this many frames in a row is drawn live instead (O8.4; spec 23's `CHURN_LIMIT`). */
const RETAKE_STREAK = 3;

/** Frames in a row with no mark in it before a live range is kept as a picture again (spec 23's `CALM_AFTER`). */
const CALM_FRAMES = 8;

/** How deep a walk up the tree goes. */
const MAX_DEPTH = 32;

/** CSS px a view may fall short of the canvas and still cover it: the reference frame rounds by a fraction. */
const COVER_SLACK = 1;

/** The whole-frame reasons after which a kept picture is taken again: the screen changed whole. */
const RETAKE_WHOLES: readonly DemandReason[] = ["resize", "restore", "debug"];

/**
 * A fresh range, made once per sync state and reused.
 *
 * @param owner - The owner overlay.
 * @returns The range.
 */
function createRange(owner: Entity): ActiveRange {
  return {
    owner,
    mode: "freeze",
    reason: undefined,
    entries: [],
    others: [],
    set: new Set(),
    before: undefined,
    kept: false,
    refused: false,
    blurred: false,
    touched: false,
    catchUp: false,
    othersStale: false,
    streak: 0,
    calm: 0,
    fallback: false
  };
}

/**
 * The name of the layer whose container a node is.
 *
 * @param state - The sync state.
 * @param node - The node.
 * @returns The layer name, or `undefined` for a node that is no layer container.
 */
function layerNameOf(state: SyncState, node: PixiContainer): string | undefined {
  for (const [name, entry] of state.layers) if (entry.container === node) return name;

  return undefined;
}

/**
 * Adds or removes a reason on one node of a range: a view's top, a layer container, or an engine object (a lower
 * overlay's dim, a kept quad). A view's visual that is no top any more is skipped: its top carries the reason. A view
 * whose reason flipped is remembered, so its mark is not read as a change of the range.
 *
 * @param sctx - Domain context of the sync module.
 * @param node - The node.
 * @param reason - The reason.
 * @param hidden - True to add it.
 */
function setNodeHidden(
  sctx: SyncCtx,
  node: PixiContainer,
  reason: HiddenReason,
  hidden: boolean
): void {
  const state = sctx.ctx.state.sync;
  const view = state.viewOfTop.get(node);

  if (view !== undefined) {
    const entity = state.entityOf.get(view.object);

    if (entity === undefined) return;

    const before = hiddenBy(view, reason);

    setHidden(sctx, entity, view, reason, hidden);
    if (hiddenBy(view, reason) !== before) state.overlay.flipped.add(entity);

    return;
  }

  if (state.entityOf.has(node)) return;

  const layer = layerNameOf(state, node);

  if (layer === undefined) setObjectHidden(sctx, node, reason, hidden);
  else setLayerHidden(sctx, layer, reason, hidden);
}

/**
 * Tells whether a node is the picture sprite of an overlay: never part of a range.
 *
 * @param sctx - Domain context of the sync module.
 * @param node - A child of a layer container.
 * @returns True for the picture of a known overlay or of the range held now.
 */
function isPicture(sctx: SyncCtx, node: PixiContainer): boolean {
  const { kept } = sctx.deps;
  const { overlay } = sctx.ctx.state.sync;

  if (overlay.active !== undefined && kept.sprite(overlay.active.owner) === node) return true;

  for (const record of overlay.order) if (kept.sprite(record.entity) === node) return true;

  return false;
}

/**
 * Fills the wanted entries and others of an owner (O5.4): the layer containers below its layer, then the children of
 * its layer container drawn before its root (rank: depth, then insertion), its own dim and every picture left out;
 * the others are every other child of the root but the owner's layer container, then every other child of that
 * container.
 *
 * @param sctx - Domain context of the sync module.
 * @param owner - The owner overlay.
 * @param root - The stage root of `sync`.
 */
function computeRange(sctx: SyncCtx, owner: OverlayRecord, root: PixiContainer): void {
  const { wantEntries: entries, wantOthers: others, wantSet: set } = sctx.ctx.state.sync.overlay;

  entries.length = 0;
  others.length = 0;
  set.clear();
  lowerLayers(sctx, owner, root);
  rootsBelow(sctx, owner);

  for (const child of root.children) {
    if (!set.has(child) && child !== owner.container) others.push(child);
  }

  for (const child of owner.container.children) {
    if (!set.has(child) && !isPicture(sctx, child)) others.push(child);
  }
}

/**
 * Adds the layer containers below the owner's layer to the wanted entries, bottom first.
 *
 * @param sctx - Domain context of the sync module.
 * @param owner - The owner overlay.
 * @param root - The stage root of `sync`.
 */
function lowerLayers(sctx: SyncCtx, owner: OverlayRecord, root: PixiContainer): void {
  const state = sctx.ctx.state.sync;
  const { wantEntries: entries, wantSet: set } = state.overlay;

  for (const spec of (state.layerList ?? []).slice(0, owner.layerIndex)) {
    const container = state.layers.get(spec.name)?.container;

    if (container?.parent === root) {
      entries.push(container);
      set.add(container);
    }
  }
}

/**
 * Adds the children of the owner's layer container drawn before its root (rank: depth, then insertion) to the
 * wanted entries; its own dim and every picture left out.
 *
 * @param sctx - Domain context of the sync module.
 * @param owner - The owner overlay.
 */
function rootsBelow(sctx: SyncCtx, owner: OverlayRecord): void {
  const { wantEntries: entries, wantSet: set } = sctx.ctx.state.sync.overlay;
  const depth = owner.object.zIndex;
  const at = owner.container.getChildIndex(owner.object);

  for (const [index, child] of owner.container.children.entries()) {
    if (child === owner.dim || isPicture(sctx, child)) continue;

    if (child.zIndex < depth || (child.zIndex === depth && index < at)) {
      entries.push(child);
      set.add(child);
    }
  }
}

/**
 * Tells whether two node lists are the same, in order.
 *
 * @param left - One list.
 * @param right - The other.
 * @returns True when they are equal.
 */
function sameList(left: readonly PixiContainer[], right: readonly PixiContainer[]): boolean {
  if (left.length !== right.length) return false;

  for (const [index, node] of left.entries()) if (right[index] !== node) return false;

  return true;
}

/**
 * Tells whether a node lies in a range: it or a node on its way up to the root is an entry.
 *
 * @param set - The entries.
 * @param node - The node.
 * @param root - The stage root.
 * @returns True when an entry holds it.
 */
export function inRange(
  set: ReadonlySet<PixiContainer>,
  node: PixiContainer,
  root: PixiContainer
): boolean {
  let current: PixiContainer | null = node;

  for (let depth = 0; depth < MAX_DEPTH && current !== null && current !== root; depth += 1) {
    if (set.has(current)) return true;

    current = current.parent;
  }

  return false;
}

/**
 * Notes a view that leaves its place while a range is held (it moves, or its view goes): if that place was in the
 * range, the range's picture changed, and the step takes it again (K1). Judged before the view moves; one check while
 * no range is held.
 *
 * @param state - The sync state.
 * @param view - The view about to move or go.
 */
export function noteLeaving(state: SyncState, view: View): void {
  const range = state.overlay.active;
  const root = state.root;

  if (range === undefined || root === undefined || state.overlay.left) return;
  if (inRange(range.set, view.wrapper ?? view.object, root)) state.overlay.left = true;
}

/**
 * Tells whether a change mark of this decision (adapter marks included) lies in the range (K1), or a view left its
 * place in it. The marks the step made itself, flipping a reason, are no change of the range's pixels.
 *
 * @param sctx - Domain context of the sync module.
 * @param set - The entries.
 * @param root - The stage root.
 * @returns True when a marked view is in the range.
 */
function markedInRange(
  sctx: SyncCtx,
  set: ReadonlySet<PixiContainer>,
  root: PixiContainer
): boolean {
  const state = sctx.ctx.state.sync;
  const { demand } = sctx.deps;

  return (
    state.overlay.left ||
    anyInRange(state, demand.marked(), set, root) ||
    anyInRange(state, demand.loose(), set, root)
  );
}

/**
 * Tells whether one of these marked entities has a view in the range and was not flipped by the step.
 *
 * @param state - The sync state.
 * @param marks - The marked entities.
 * @param set - The entries.
 * @param root - The stage root.
 * @returns True when a marked view is in the range.
 */
function anyInRange(
  state: SyncState,
  marks: ReadonlySet<Entity>,
  set: ReadonlySet<PixiContainer>,
  root: PixiContainer
): boolean {
  for (const entity of marks) {
    if (state.overlay.flipped.has(entity)) continue;

    const view = state.views.get(entity);

    if (view !== undefined && inRange(set, view.wrapper ?? view.object, root)) return true;
  }

  return false;
}

/**
 * Tells whether a slot list holds an enabled filter that blurs what is under it.
 *
 * @param slots - The slots of a view.
 * @returns True for an enabled slot with `blurs`.
 */
function blursIn(slots: readonly FilterSlot[]): boolean {
  for (const slot of slots) if (slot.blurs === true && slot.filter.enabled) return true;

  return false;
}

/**
 * Tells whether a view's bounds hold the whole canvas, within `COVER_SLACK`.
 *
 * @param top - The view's top.
 * @param screen - The canvas size, CSS px.
 * @returns True when it covers the canvas.
 */
function coversCanvas(
  top: PixiContainer,
  screen: Readonly<{ width: number; height: number }>
): boolean {
  const bounds = top.getBounds();

  return (
    bounds.x <= COVER_SLACK &&
    bounds.y <= COVER_SLACK &&
    bounds.x + bounds.width >= screen.width - COVER_SLACK &&
    bounds.y + bounds.height >= screen.height - COVER_SLACK
  );
}

/**
 * Whether a range is blurred (O9.2, OQ22-3): an entry root that is a view, or a view inside the range whose bounds
 * hold the canvas, carries an enabled blurring slot. Read from the slots, never from where the filters hang.
 *
 * @param sctx - Domain context of the sync module.
 * @param set - The entries.
 * @param root - The stage root.
 * @returns True when the range is blurred.
 */
function measureBlurred(
  sctx: SyncCtx,
  set: ReadonlySet<PixiContainer>,
  root: PixiContainer
): boolean {
  const state = sctx.ctx.state.sync;
  const screen = sctx.deps.host.screen();

  for (const [entity, slots] of state.filters) {
    const view = state.views.get(entity);

    if (view === undefined || !blursIn(slots)) continue;

    const top = view.wrapper ?? view.object;

    if (set.has(top)) return true;
    if (screen === undefined || !inRange(set, top, root)) continue;
    if (coversCanvas(top, screen)) return true;
  }

  return false;
}

/**
 * Writes the new reason on the wanted entries, then takes the old one off the entries that keep a new one or left the
 * range: a node is never shown in between (O5.5).
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range, still holding the last frame's entries.
 * @param from - The reason written last frame.
 * @param to - The reason wanted now.
 */
function writeReasons(
  sctx: SyncCtx,
  range: ActiveRange,
  from: HiddenReason | undefined,
  to: HiddenReason | undefined
): void {
  const overlay = sctx.ctx.state.sync.overlay;

  if (to !== undefined) for (const node of overlay.wantEntries) setNodeHidden(sctx, node, to, true);

  if (from === undefined) return;

  for (const node of range.entries) {
    if (from !== to || !overlay.wantSet.has(node)) setNodeHidden(sctx, node, from, false);
  }
}

/**
 * Copies the wanted lists into the range: the arrays in place, the sets swapped.
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range.
 */
function keepWanted(sctx: SyncCtx, range: ActiveRange): void {
  const overlay = sctx.ctx.state.sync.overlay;
  const set = range.set;

  copyInto(range.entries, overlay.wantEntries);
  copyInto(range.others, overlay.wantOthers);
  range.set = overlay.wantSet;
  overlay.wantSet = set;
}

/**
 * Copies a node list into another in place, writing only where they differ: a frame whose range stands allocates and
 * writes nothing.
 *
 * @param into - The list kept.
 * @param from - The list wanted now.
 */
function copyInto(into: PixiContainer[], from: readonly PixiContainer[]): void {
  for (const [index, node] of from.entries()) if (into[index] !== node) into[index] = node;

  into.length = from.length;
}

/**
 * The range handed to `kept`: the wanted lists and the slot right before the owner's dim, or its root.
 *
 * @param sctx - Domain context of the sync module.
 * @param owner - The owner overlay.
 * @returns The range.
 */
function keptRangeOf(sctx: SyncCtx, owner: OverlayRecord): KeptRange {
  const overlay = sctx.ctx.state.sync.overlay;

  return {
    id: owner.entity,
    entries: overlay.wantEntries,
    others: overlay.wantOthers,
    slot: { container: owner.container, before: owner.dim ?? owner.object }
  };
}

/**
 * Hands the range to `kept` (a take, or a retake with new lists for an owner that holds one) and asks for the frame.
 * A refusal draws the range live with one debug line.
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range.
 * @param owner - The owner overlay.
 * @param root - The stage root.
 * @returns True when a picture holds the range.
 */
function handOver(
  sctx: SyncCtx,
  range: ActiveRange,
  owner: OverlayRecord,
  root: PixiContainer
): boolean {
  const taken = sctx.deps.kept.take(keptRangeOf(sctx, owner));

  if (!taken) {
    range.refused = true;
    range.kept = false;
    sctx.ctx.log.debug("renderer:overlay-live", { entity: owner.entity, reason: "refused" });

    return false;
  }

  sctx.deps.demand.whole("retake");
  range.kept = true;
  range.refused = false;
  range.othersStale = false;
  range.before = owner.dim ?? owner.object;
  range.blurred = measureBlurred(sctx, sctx.ctx.state.sync.overlay.wantSet, root);

  return true;
}

/**
 * Takes a held picture again in this frame: with the new lists when the others changed since the last hand-over.
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range.
 * @param owner - The owner overlay.
 * @param root - The stage root.
 * @returns True when a picture still holds the range.
 */
function retake(
  sctx: SyncCtx,
  range: ActiveRange,
  owner: OverlayRecord,
  root: PixiContainer
): boolean {
  if (range.othersStale) return handOver(sctx, range, owner, root);

  sctx.deps.kept.retake(owner.entity);
  sctx.deps.demand.whole("retake");
  range.blurred = measureBlurred(sctx, sctx.ctx.state.sync.overlay.wantSet, root);

  return true;
}

/**
 * Queues one fallback line of an agent build: the range went live, or is kept again.
 *
 * @param sctx - Domain context of the sync module.
 * @param owner - The owner overlay.
 * @param what - `"live"` or `"kept"`.
 */
function noteFallback(sctx: SyncCtx, owner: OverlayRecord, what: "live" | "kept"): void {
  if (!(typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) return;

  sctx.ctx.state.sync.overlay.events.push({
    entity: owner.entity,
    label: owner.label,
    what,
    mode: what === "live" ? "live" : "freeze"
  });
}

/**
 * The retake rules of a held picture whose lists stand (O8.3, O8.4): the catch-up of held loops, a mark in the range
 * (live after three frames in a row), the screen changed whole, and the landing and the first exit frame with a loop
 * held. Others that changed are handed over with the next retake.
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range, a picture held.
 * @param owner - The owner overlay.
 * @param root - The stage root.
 * @param context - The frame: its whole reasons and whether the others changed.
 * @param context.wholes - The whole-frame reasons of this decision.
 * @param context.othersChanged - True when the others differ from the last frame.
 * @returns The reason the entries carry now: `"freeze"`, or none when the range went live.
 */
function stepKept(
  sctx: SyncCtx,
  range: ActiveRange,
  owner: OverlayRecord,
  root: PixiContainer,
  context: { wholes: ReadonlySet<DemandReason>; othersChanged: boolean }
): HiddenReason | undefined {
  if (context.othersChanged) range.othersStale = true;

  const owed = retakeOwed(sctx, range, owner, root);

  if (owed === "live") return undefined;

  // The screen changed whole: the picture is taken again, unless this frame took it already.
  if (owed === "none" && RETAKE_WHOLES.some(reason => context.wholes.has(reason))) {
    retake(sctx, range, owner, root);
  }

  if (range.touched && (owner.turned === "shown" || owner.turned === "exiting")) {
    // The held loops write once in the next frame, and that frame takes the picture with them.
    range.catchUp = true;
  }

  return range.kept ? "freeze" : undefined;
}

/**
 * The retakes a held picture owes its own range (O8.3, O8.4): the catch-up frame of held loops, and a mark in the
 * range, which after three frames in a row lets the range go live instead.
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range, a picture held.
 * @param owner - The owner overlay.
 * @param root - The stage root.
 * @returns `"taken"` when a picture holds the range after a retake, `"live"` when it fell back, `"none"` otherwise.
 */
function retakeOwed(
  sctx: SyncCtx,
  range: ActiveRange,
  owner: OverlayRecord,
  root: PixiContainer
): "taken" | "live" | "none" {
  // The held loops wrote their catch-up frame: the picture is taken with them.
  if (range.catchUp) {
    range.catchUp = false;
    range.touched = false;

    return retake(sctx, range, owner, root) ? "taken" : "none";
  }

  // No mark in the range: the streak ends.
  if (!markedInRange(sctx, sctx.ctx.state.sync.overlay.wantSet, root)) {
    range.streak = 0;

    return "none";
  }

  range.streak += 1;

  if (range.streak < RETAKE_STREAK) return retake(sctx, range, owner, root) ? "taken" : "none";

  // Three marked frames in a row: the range is drawn live until it calms down.
  range.streak = 0;
  range.calm = 0;
  range.fallback = true;
  range.kept = false;
  noteFallback(sctx, owner, "live");

  return "live";
}

/**
 * The reason of a freeze range this frame, its picture taken, retaken or let go (O5.5, O8.2–O8.4).
 *
 * @param sctx - Domain context of the sync module.
 * @param range - The range of this owner, counters reset when it is new.
 * @param owner - The owner overlay.
 * @param root - The stage root.
 * @param context - What changed since the last frame.
 * @param context.fresh - The owner is new, or was covering until now.
 * @param context.entriesChanged - The entries differ from the last frame.
 * @param context.othersChanged - The others differ from the last frame.
 * @param context.wholes - The whole-frame reasons of this decision.
 * @returns `"freeze"` when a picture holds the range, none when it is drawn live.
 */
function stepFreeze(
  sctx: SyncCtx,
  range: ActiveRange,
  owner: OverlayRecord,
  root: PixiContainer,
  context: {
    fresh: boolean;
    entriesChanged: boolean;
    othersChanged: boolean;
    wholes: ReadonlySet<DemandReason>;
  }
): HiddenReason | undefined {
  const overlay = sctx.ctx.state.sync.overlay;

  // Kept pictures switched off: the range is drawn live; switched on again, the debug frame lets it try again.
  if (!sctx.deps.kept.isOn()) {
    if (!range.refused) {
      sctx.ctx.log.debug("renderer:overlay-live", { entity: owner.entity, reason: "off" });
    }

    range.refused = true;
    range.kept = false;

    return undefined;
  }

  // A switch of the kept pictures, and any change of the range, lets a refused range try again.
  if (context.entriesChanged || context.wholes.has("debug")) range.refused = false;

  if (range.fallback) {
    range.calm = markedInRange(sctx, overlay.wantSet, root) ? 0 : range.calm + 1;

    if (range.calm < CALM_FRAMES) return undefined;

    range.fallback = false;
    range.calm = 0;
    noteFallback(sctx, owner, "kept");

    return handOver(sctx, range, owner, root) ? "freeze" : undefined;
  }

  if (range.refused) return undefined;

  if (context.fresh || context.entriesChanged || !range.kept) {
    return handOver(sctx, range, owner, root) ? "freeze" : undefined;
  }

  return stepKept(sctx, range, owner, root, context);
}

/**
 * Lets the range go: its reason off every entry, its picture released, no range held. Used when no overlay owns one,
 * and for new layers.
 *
 * @param sctx - Domain context of the sync module.
 */
export function clearRange(sctx: SyncCtx): void {
  const overlay = sctx.ctx.state.sync.overlay;
  const range = overlay.active;

  if (range === undefined) return;

  if (range.reason !== undefined) {
    for (const node of range.entries) setNodeHidden(sctx, node, range.reason, false);
  }

  if (range.kept) sctx.deps.kept.release(range.owner);

  range.entries.length = 0;
  range.others.length = 0;
  range.set.clear();
  range.reason = undefined;
  range.kept = false;
  overlay.active = undefined;
}

/**
 * The owner of the range: the topmost overlay that covers or keeps; an opaque overlay leaving is passed.
 *
 * @param order - The overlays, bottom first.
 * @returns The owner, or `undefined` when none keeps a range.
 */
function ownerOf(order: readonly OverlayRecord[]): OverlayRecord | undefined {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const record = order[index];

    if (record !== undefined && record.mode !== "live") return record;
  }

  return undefined;
}

/**
 * Resets the counters of a range for a new owner, or for an owner that changes between cover and freeze.
 *
 * @param range - The range.
 * @param owner - The owner overlay.
 * @param keepsPicture - True when the owner still holds its picture (it stays the owner).
 */
function freshRange(range: ActiveRange, owner: Entity, keepsPicture: boolean): void {
  range.owner = owner;
  range.kept = keepsPicture;
  range.refused = false;
  range.blurred = false;
  range.touched = false;
  range.catchUp = false;
  range.othersStale = false;
  range.streak = 0;
  range.calm = 0;
  range.fallback = false;
  range.before = undefined;
}

/**
 * The range of this frame: its owner, its entries, the reason they carry and the picture, all written in this one
 * step (O5.4, O5.5, O8). A new owner takes its picture before the last owner's goes; an owner that lands opaque writes
 * `"cover"` before `"freeze"` comes off and lets its picture go.
 *
 * @param sctx - Domain context of the sync module.
 * @param wholes - The whole-frame reasons of this decision.
 */
export function stepRange(sctx: SyncCtx, wholes: ReadonlySet<DemandReason>): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;
  const root = state.root;
  const owner = ownerOf(overlay.order);

  // No overlay covers or keeps: the range goes.
  if (owner === undefined || root === undefined) {
    clearRange(sctx);

    return;
  }

  // The wanted lists of this frame, and what changed against the range held since the last one.
  computeRange(sctx, owner, root);

  const previous = overlay.active;
  const range = overlay.range ?? createRange(owner.entity);
  const mode = owner.mode === "cover" ? "cover" : "freeze";
  const sameOwner = previous !== undefined && previous.owner === owner.entity;
  const fresh = !sameOwner || previous.mode !== mode;
  const from = previous?.reason;
  const held = previous?.kept === true ? previous.owner : undefined;
  const entriesChanged = !sameOwner || !sameList(range.entries, overlay.wantEntries);
  const othersChanged = !sameOwner || !sameList(range.others, overlay.wantOthers);

  overlay.range = range;

  // A range held by no one starts empty; a new owner, or a new mode, starts its counters again.
  if (previous === undefined) {
    range.entries.length = 0;
    range.others.length = 0;
    range.set.clear();
  }

  if (fresh) freshRange(range, owner.entity, sameOwner && held !== undefined && mode === "freeze");

  range.mode = mode;

  // The reason of this frame: `"cover"` for an opaque owner, otherwise what the freeze rules decide.
  const to =
    mode === "cover"
      ? "cover"
      : stepFreeze(sctx, range, owner, root, { fresh, entriesChanged, othersChanged, wholes });

  if (mode === "cover") range.kept = false;

  // The new reason on before the old one comes off, then the wanted lists become the range.
  writeReasons(sctx, range, from, to);
  keepWanted(sctx, range);
  range.reason = to;
  overlay.active = range;

  // The last owner's picture goes after the new one was taken.
  if (held !== undefined && (held !== owner.entity || !range.kept)) sctx.deps.kept.release(held);

  // A held picture follows its owner's dim, or its root, in this frame.
  const before = owner.dim ?? owner.object;

  if (range.kept && range.before !== before) {
    sctx.deps.kept.move(owner.entity, { container: owner.container, before });
    sctx.deps.demand.whole("overlay");
    range.before = before;
  }
}

/**
 * Whether a range holds the loops of its views at all: while its entries are hidden or kept, and while the live
 * fallback draws it until its owner leaves (O8.4). Under the sheet the loops stay held as in its picture, so only a real
 * change counts against the calm frames that bring the picture back; from the owner's first exit frame they run. A
 * range drawn live for another cause (a refused picture, kept pictures off) holds nothing.
 *
 * @param state - The sync state.
 * @param range - The range held now.
 * @returns True when the loops of its views may be held.
 */
function holdsLoops(state: SyncState, range: ActiveRange): boolean {
  if (range.reason !== undefined) return true;

  return range.fallback && state.overlay.records.get(range.owner)?.phase !== "exiting";
}

/**
 * Tells whether the endless loops of a view should write nothing (the overlay cases of `loopsHeld`, O9.2): its view
 * lies in a range an opaque overlay covers, or in a held picture of a blurred range, or in a blurred range the
 * fallback draws live; the last two touch the range, so the held loops write once at landing and at the first exit
 * frame.
 *
 * @param state - The sync state.
 * @param entity - The entity a loop is about to write.
 * @returns True when the write would change nothing the player sees.
 */
export function rangeHolds(state: SyncState, entity: Entity): boolean {
  const range = state.overlay.active;

  if (range === undefined || range.catchUp || !holdsLoops(state, range)) return false;

  const view = state.views.get(entity);
  const root = state.root;

  if (view === undefined || root === undefined) return false;
  if (!inRange(range.set, view.wrapper ?? view.object, root)) return false;
  if (range.reason === "cover") return true;
  if (!range.blurred) return false;

  range.touched = true;

  return true;
}
