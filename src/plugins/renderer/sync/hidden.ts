/**
 * @file renderer/sync — the one owner of renderable: why a view, a layer or an engine object is not drawn. Each reason
 * has one writer: "empty" and "alpha" spec 26 (B7, B9); "cover" and "freeze" spec 22 (O5.5); "kept" spec 23 (OQ23-1).
 * Hit testing never reads `renderable`.
 */
import type { Entity } from "../../world/types";
import type { DemandModule, PixiContainer, RendererCtx } from "../types";
import type { SyncState, View } from "./types";

/**
 * Why a view is not drawn. A view is drawn when no reason holds.
 */
export type HiddenReason = "empty" | "alpha" | "cover" | "freeze" | "kept";

/**
 * What the hidden writers need: the renderer context (its sync state) and the demand marks. `SyncCtx` satisfies it,
 * and the kept module builds one from what it owns (O14; skeleton choice, confirmed in LEAD-FIXES-3).
 */
export type HiddenCtx = {
  readonly ctx: RendererCtx;
  readonly deps: { readonly demand: DemandModule };
};

/** The bit of each reason in a mask. */
const BITS: Readonly<Record<HiddenReason, number>> = {
  empty: 1,
  alpha: 2,
  cover: 4,
  freeze: 8,
  kept: 16
};

/** The two masks of a view: the visual itself, and the whole subtree on its top. */
type MaskName = "hiddenSelf" | "hiddenTop";

/**
 * The mask a reason goes into on a view, resolved at every call (OQ26-1): `"empty"` hides the visual only, `"alpha"`
 * the object of an adapter (its own alpha) and the top of a built-in visual (the alpha fades the subtree), the three
 * subtree reasons the top of every kind.
 *
 * @param view - The view.
 * @param reason - The reason.
 * @returns The mask's field.
 */
function maskOf(view: View, reason: HiddenReason): MaskName {
  if (reason === "empty" || (reason === "alpha" && view.kind === "adapter")) return "hiddenSelf";

  return "hiddenTop";
}

/**
 * Tells whether a view takes a reason: a game's `Display` object is never hidden for being empty or transparent.
 *
 * @param view - The view.
 * @param reason - The reason.
 * @returns False for `"empty"` and `"alpha"` on a `Display` view.
 */
function takes(view: View, reason: HiddenReason): boolean {
  return view.kind !== "Display" || (reason !== "empty" && reason !== "alpha");
}

/**
 * A mask with one reason added or removed. Pure.
 *
 * @param mask - The mask now.
 * @param reason - The reason.
 * @param hidden - True to add it, false to remove it.
 * @returns The new mask.
 * @example
 * ```ts
 * toggled(4, "freeze", true); // 12
 * ```
 */
function toggled(mask: number, reason: HiddenReason, hidden: boolean): number {
  return hidden ? mask | BITS[reason] : mask & ~BITS[reason];
}

/**
 * Tells whether one reason added or removed changes a view's mask.
 *
 * @param view - The view.
 * @param reason - The reason.
 * @param hidden - True to add it, false to remove it.
 * @returns True when the mask changes.
 */
function changes(view: View, reason: HiddenReason, hidden: boolean): boolean {
  if (!takes(view, reason)) return false;

  const mask = view[maskOf(view, reason)];

  return toggled(mask, reason, hidden) !== mask;
}

/**
 * Writes `renderable` on a node only when it differs: Pixi marks its render group's structure on every flip.
 *
 * @param node - The node.
 * @param renderable - Whether it is drawn.
 */
function writeNode(node: PixiContainer, renderable: boolean): void {
  if (node.renderable !== renderable) node.renderable = renderable;
}

/**
 * The view a node belongs to: the view whose top it is, or the view whose visual it is inside a wrapper.
 *
 * @param state - The sync state.
 * @param node - The node.
 * @returns The view, or `undefined` for a node that is no part of a view.
 */
function viewOfNode(state: SyncState, node: PixiContainer): View | undefined {
  const top = state.viewOfTop.get(node);

  if (top !== undefined) return top;

  const entity = state.entityOf.get(node);

  return entity === undefined ? undefined : state.views.get(entity);
}

/**
 * The mask that decides whether a node is drawn: a view's top or visual, a layer container, or an engine object.
 *
 * @param state - The sync state.
 * @param node - The node.
 * @returns The mask, 0 for a node no reason hides.
 */
function nodeMask(state: SyncState, node: PixiContainer): number {
  const view = viewOfNode(state, node);

  if (view !== undefined) {
    if (node === view.wrapper) return view.hiddenTop;

    return view.wrapper === undefined ? view.hiddenSelf | view.hiddenTop : view.hiddenSelf;
  }

  for (const entry of state.layers.values()) if (entry.container === node) return entry.hidden;

  return state.objectHidden.get(node) ?? 0;
}

/**
 * Adds or removes one reason a view is not drawn. A change marks the entity before the write, so the mark is judged as
 * the view stood before; the same reason again writes and marks nothing.
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param entity - The view's entity.
 * @param view - The view.
 * @param reason - The reason.
 * @param hidden - True to add the reason, false to remove it.
 */
export function setHidden(
  sctx: HiddenCtx,
  entity: Entity,
  view: View,
  reason: HiddenReason,
  hidden: boolean
): void {
  if (!changes(view, reason, hidden)) return;

  sctx.deps.demand.mark(entity);
  swapHidden(sctx, view, reason, hidden);
}

/**
 * Changes one reason of a view and its `renderable` without a mark: the view and the quad that stands for it draw the
 * same pixels. Used by spec 23 for `"kept"`.
 *
 * @param sctx - The sync context, or any `HiddenCtx`: its render-pass version moves on.
 * @param view - The view.
 * @param reason - The reason.
 * @param hidden - True to add the reason, false to remove it.
 */
export function swapHidden(
  sctx: HiddenCtx,
  view: View,
  reason: HiddenReason,
  hidden: boolean
): void {
  if (!changes(view, reason, hidden)) return;

  // A view drawn or not changes the render passes of a frame (Q2); a kept picture taken or let go swaps `"kept"` here.
  sctx.ctx.state.sync.passesVersion += 1;

  const name = maskOf(view, reason);

  view[name] = toggled(view[name], reason, hidden);
  writeRenderable(view);
}

/**
 * Puts each mask of a view on its node: the only place a view's `renderable` is written. Called by `ensureWrapper`.
 *
 * @param view - The view.
 */
export function writeRenderable(view: View): void {
  if (view.wrapper === undefined) {
    writeNode(view.object, (view.hiddenSelf | view.hiddenTop) === 0);

    return;
  }

  writeNode(view.object, view.hiddenSelf === 0);
  writeNode(view.wrapper, view.hiddenTop === 0);
}

/**
 * Clears every hidden reason of a view that leaves and draws it again: zeroes `hiddenSelf` and `hiddenTop`, then
 * `writeRenderable`. Called by `resetObject` (O19, LEAD-FIXES-3), so no file but this one writes `renderable`, and by
 * the release, the restore and the stop of a game's or an adapter's object. A view no reason hides is left as it is:
 * nothing of this file is on its nodes, and a game's own `renderable` stays the game's.
 *
 * @param view - The view that leaves: pooled, released, rebuilt or stopped.
 */
export function clearHidden(view: View): void {
  if (view.hiddenSelf === 0 && view.hiddenTop === 0) return;

  view.hiddenSelf = 0;
  view.hiddenTop = 0;
  writeRenderable(view);
}

/**
 * Adds or removes one reason a layer container is not drawn ("cover" and "freeze" only).
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param name - The layer name.
 * @param reason - The reason.
 * @param hidden - True to add the reason, false to remove it.
 */
export function setLayerHidden(
  sctx: HiddenCtx,
  name: string,
  reason: HiddenReason,
  hidden: boolean
): void {
  const entry = sctx.ctx.state.sync.layers.get(name);

  if (entry === undefined) return;

  const next = toggled(entry.hidden, reason, hidden);

  if (next === entry.hidden) return;

  sctx.deps.demand.whole("overlay");
  sctx.ctx.state.sync.passesVersion += 1;
  entry.hidden = next;
  if (entry.container !== undefined) writeNode(entry.container, next === 0);
}

/**
 * Adds or removes one reason an engine object that is no view is not drawn: an overlay's dim, a kept view's quad that
 * hangs in a layer container.
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param object - The engine object.
 * @param reason - The reason.
 * @param hidden - True to add the reason, false to remove it.
 */
export function setObjectHidden(
  sctx: HiddenCtx,
  object: PixiContainer,
  reason: HiddenReason,
  hidden: boolean
): void {
  const masks = sctx.ctx.state.sync.objectHidden;
  const mask = masks.get(object) ?? 0;
  const next = toggled(mask, reason, hidden);

  if (next === mask) return;

  sctx.deps.demand.whole("overlay");

  if (next === 0) masks.delete(object);
  else masks.set(object, next);

  writeNode(object, next === 0);
}

/**
 * Draws a picture of nodes hidden only by one reason: lifts them, hides the others for the call, draws, and puts every
 * node back from its mask, also when `draw` throws. No mark. A node of `lift` hidden by another reason too stays hidden.
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param lift - Nodes to draw: view tops, layer containers, engine objects.
 * @param hide - Nodes to keep out of the picture.
 * @param reason - The one reason a lifted node may be hidden by.
 * @param draw - The render (or the pixel extract of the oracle); its result is returned.
 * @returns What `draw` returned.
 */
export function liftFor<Result>(
  sctx: HiddenCtx,
  lift: readonly PixiContainer[],
  hide: readonly PixiContainer[],
  reason: HiddenReason,
  draw: () => Result
): Result {
  const state = sctx.ctx.state.sync;

  try {
    for (const node of lift) if (nodeMask(state, node) === BITS[reason]) writeNode(node, true);
    for (const node of hide) writeNode(node, false);
    // The render passes count what the picture draws, and again what the frame draws after it (Q2).
    state.passesVersion += 1;

    return draw();
  } finally {
    for (const node of lift) writeNode(node, nodeMask(state, node) === 0);
    for (const node of hide) writeNode(node, nodeMask(state, node) === 0);
    state.passesVersion += 1;
  }
}

/**
 * Tells whether one reason hides a view, in the mask that reason uses.
 *
 * @param view - The view.
 * @param reason - The reason.
 * @returns True when the reason holds.
 */
export function hiddenBy(view: View, reason: HiddenReason): boolean {
  return (view[maskOf(view, reason)] & BITS[reason]) !== 0;
}

/**
 * Tells whether one reason hides a layer container (O16; skeleton choice, confirmed in LEAD-FIXES-3).
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param name - The layer name.
 * @param reason - The reason.
 * @returns True when the reason holds; false for a layer the scene does not declare.
 */
export function layerHiddenBy(sctx: HiddenCtx, name: string, reason: HiddenReason): boolean {
  return ((sctx.ctx.state.sync.layers.get(name)?.hidden ?? 0) & BITS[reason]) !== 0;
}

/**
 * Tells whether a node is hidden by exactly this one reason: spec 23's "hidden only by kept" and "only by freeze"
 * (O16; skeleton choice, confirmed in LEAD-FIXES-3).
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param node - A view top, a layer container or an engine object.
 * @param reason - The reason.
 * @returns True when that reason and no other hides the node.
 */
export function onlyHiddenBy(sctx: HiddenCtx, node: PixiContainer, reason: HiddenReason): boolean {
  return nodeMask(sctx.ctx.state.sync, node) === BITS[reason];
}

/**
 * Tells whether a node is hidden, and by these reasons alone: spec 23's eligibility of a picture whose ancestor is in
 * an overlay's range (`"freeze"`) or is itself a kept top drawn through its quad (`"kept"`).
 *
 * @param sctx - The sync context, or any `HiddenCtx`.
 * @param node - A view top, a layer container or an engine object.
 * @param reasons - The reasons allowed.
 * @returns True when a reason hides the node and every reason that does is one of them.
 */
export function hiddenOnlyAmong(
  sctx: HiddenCtx,
  node: PixiContainer,
  reasons: readonly HiddenReason[]
): boolean {
  let allowed = 0;

  for (const reason of reasons) allowed |= BITS[reason];

  const mask = nodeMask(sctx.ctx.state.sync, node);

  return mask !== 0 && (mask & ~allowed) === 0;
}
