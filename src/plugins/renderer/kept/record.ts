/**
 * @file renderer/kept — one cached view: whether it may be kept, the keys of its stages, its two lives and the policy
 * between them (P4). A view that stood still for two drawn frames is taken; a kept view whose subtree changes in three
 * drawn frames in a row goes live until it stood still for eight; a move only moves the quad. Taking and releasing
 * happen inside the flush, before the stage pass, both halves in the same frame (K3).
 */
import type { FilterSlot, SyncState, SyncWriters, View } from "../sync/types";
import type { PixiContainer, PixiFilter, PixiModule } from "../types";
import { makeRoom, warnRefused } from "./budget";
import {
  fitsTexture,
  gridSpan,
  KEY,
  KEY_SIZE,
  linearBounds,
  onGrid,
  paddingOnGrid,
  textureBytes
} from "./geometry";
import {
  bytesOf,
  dropTexture,
  endLoan,
  firstInputs,
  labelOf,
  renderStage1,
  renderStage2,
  renderStage3,
  standInOf
} from "./render";
import { destroyRecord } from "./state";
import type { KeptCtx, KeptMatrices, KeptRecord } from "./types";

/** Drawn frames a live view stands still before it is taken. */
export const TAKE_AFTER = 2;

/** Stage-1 retakes in a row after which a kept view goes live. */
export const CHURN_LIMIT = 3;

/** Drawn frames a view that churned stands still before it is taken again. */
export const CALM_AFTER = 8;

/** The reasons an ancestor may be hidden by and still draw the view: an overlay's range, a kept ancestor's picture. */
const DRAWN_ANYWAY = ["freeze", "kept"] as const;

/** The tint of a container that tints nothing. */
const WHITE = 0xff_ff_ff;

/** What a stack of filters draws with this frame. Reused: one object for the module. */
type Stack = { enabled: number; rs: number; P: number };

/** The numbers of one frame of a record: the stack and the top's world transform. */
type Numbers = Stack & {
  r: number;
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

/** The numbers of the record being stepped. One object: a step allocates nothing. */
const NOW: Numbers = { enabled: 0, rs: 1, P: 0, r: 1, a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/**
 * The resolution one filter draws at: its own, or the target's for `"inherit"` (Pixi's own rule).
 *
 * @param filter - The filter.
 * @param resolution - The target's resolution.
 * @returns Texels per CSS px.
 */
function resolutionOf(filter: PixiFilter, resolution: number): number {
  const own: number | "inherit" = filter.resolution;

  return own === "inherit" ? resolution : own;
}

/**
 * Reads what the enabled filters of a stack draw with: how many, the smallest resolution, and the padding sum Pixi
 * pads by (whole pixels).
 *
 * @param slots - The record's slots.
 * @param resolution - The renderer resolution.
 * @param into - Where the numbers go.
 */
function readStack(slots: readonly FilterSlot[], resolution: number, into: Stack): void {
  let enabled = 0;
  let rs = Number.POSITIVE_INFINITY;
  let padding = 0;

  for (const slot of slots) {
    if (!slot.filter.enabled) continue;

    enabled += 1;
    rs = Math.min(rs, resolutionOf(slot.filter, resolution));
    padding += slot.filter.padding;
  }

  into.enabled = enabled;
  into.rs = enabled === 0 ? resolution : rs;
  into.P = Math.trunc(padding);
}

/**
 * Tells whether a blend mode draws over what is under it as a picture does.
 *
 * @param mode - A container's or a filter's blend mode.
 * @returns True for `"inherit"` and `"normal"`.
 */
function plainBlend(mode: string): boolean {
  return mode === "inherit" || mode === "normal";
}

/**
 * Tells whether a node holds filters.
 *
 * @param node - The node.
 * @returns True when it holds at least one.
 */
function holdsFilters(node: PixiContainer): boolean {
  const filters: readonly PixiFilter[] | null | undefined = node.filters;

  return filters !== null && filters !== undefined && filters.length > 0;
}

/**
 * Tells whether the filters of a stack draw like a picture: none reads the backdrop, every one blends normally.
 *
 * @param slots - The record's slots.
 * @returns True when they do.
 */
function plainFilters(slots: readonly FilterSlot[]): boolean {
  for (const slot of slots) {
    const { filter } = slot;

    if (filter.enabled && (filter.blendRequired || !plainBlend(filter.blendMode))) return false;
  }

  return true;
}

/**
 * The filters `sync` keeps for an entity, as `setFilters` stored them.
 *
 * @param state - The sync state.
 * @param entity - The entity.
 * @returns Its slots, empty when it has none.
 */
function filtersOf(state: SyncState, entity: number): readonly FilterSlot[] {
  return state.filters.get(entity) ?? [];
}

/**
 * Tells whether the view's top is drawn: no hidden reason but its own picture and an overlay's range holds it.
 *
 * @param sync - The writers of `sync`: its reader of the hidden reasons.
 * @param view - The view.
 * @returns True when nothing else hides it.
 */
function topDrawn(sync: SyncWriters, view: View): boolean {
  const { hiddenBy } = sync;

  if (hiddenBy(view, "cover")) return false;
  if (hiddenBy(view, "alpha") && (view.kind !== "adapter" || view.wrapper === undefined))
    return false;

  return !(hiddenBy(view, "empty") && view.wrapper === undefined);
}

/**
 * Tells whether every ancestor up to the stage draws the view as a picture would: visible, opaque, untinted, blending
 * normally, drawn (an overlay's range and a kept ancestor's picture count), and for a placed filter without a filter
 * above it (its canvas position would not be the canvas pixel live).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param stage - The stage of the application.
 * @returns True when they do.
 */
function ancestorsPlain(kctx: KeptCtx, record: KeptRecord, stage: PixiContainer): boolean {
  for (let node = record.top.parent; node !== stage; node = node.parent) {
    if (node === null) return false;
    if (!node.visible || node.alpha !== 1 || node.tint !== WHITE || !plainBlend(node.blendMode)) {
      return false;
    }
    if (!node.renderable && !kctx.sync.hiddenOnlyAmong(kctx.hidden, node, DRAWN_ANYWAY))
      return false;
    if (
      record.category === "placed" &&
      (holdsFilters(node) || kctx.state.byTop.get(node)?.mode === "kept")
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a record may be kept this frame (P4.1): an enabled filter, filters that draw like a picture, a top that
 * blends normally and is drawn, ancestors that draw it as a picture would, and the switch on.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 * @param stack - The stack of this frame.
 * @returns True when it may be kept.
 */
function eligible(kctx: KeptCtx, record: KeptRecord, view: View, stack: Stack): boolean {
  const { top } = record;
  const stage = kctx.host.stage();

  return (
    kctx.state.on &&
    !kctx.state.bypassed &&
    stage !== undefined &&
    stack.enabled > 0 &&
    plainFilters(record.slots) &&
    top.visible &&
    top.alpha > 0 &&
    plainBlend(top.blendMode) &&
    topDrawn(kctx.sync, view) &&
    ancestorsPlain(kctx, record, stage)
  );
}

/**
 * Tells whether a view of kind `"Display"` hangs in a subtree, the top included: a game's own object it may write
 * without telling the renderer when `onDemand` is off. A walk, made only at a take.
 *
 * @param kctx - The kept context.
 * @param top - The subtree's top.
 * @returns True when one does.
 */
function holdsDisplay(kctx: KeptCtx, top: PixiContainer): boolean {
  const { entityOf, views } = kctx.ctx.state.sync;
  const open: PixiContainer[] = [top];

  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    const entity = entityOf.get(node);

    if (entity !== undefined && views.get(entity)?.kind === "Display") return true;

    open.push(...node.children);
  }

  return false;
}

/**
 * Makes the record of a filtered view, live, with keys no frame has seen.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param entity - The entity.
 * @param view - Its view.
 * @param slots - Its slots.
 * @param category - The worst category of the slots.
 * @returns The record, in the maps and the list.
 */
export function createRecord(
  kctx: KeptCtx,
  pixi: PixiModule,
  entity: number,
  view: View,
  slots: readonly FilterSlot[],
  category: "local" | "placed"
): KeptRecord {
  const top = view.wrapper ?? view.object;
  const key = new Float64Array(KEY_SIZE).fill(Number.NaN);
  const record: KeptRecord = {
    entity,
    top,
    wasGroup: top.isRenderGroup,
    mode: "live",
    slots,
    category,
    standIn: undefined,
    keeperStandIn: undefined,
    quad: undefined,
    keeper: undefined,
    s1: undefined,
    s2: [],
    s3: undefined,
    s1Version: 0,
    s2InputsVersion: 0,
    s2PictureVersion: 0,
    s2Of: undefined,
    dirtyS1: true,
    dirtyS2: false,
    dirtyS3: false,
    key,
    matrix: new pixi.Matrix(),
    still: 0,
    churn: 0,
    calm: false,
    lastDrawn: kctx.state.frame,
    depth: 0,
    bytes: 0,
    settle: false,
    refused: 0,
    displays: undefined
  };
  const { state } = kctx;

  state.records.push(record);
  state.byEntity.set(entity, record);
  state.byTop.set(top, record);
  state.unsorted = true;

  return record;
}

/**
 * Puts a placed filter's origin back to 0: drawn live, `canvasPixel` reads the canvas through `uOutputFrame` alone.
 *
 * @param slots - The record's slots.
 */
function zeroOrigins(slots: readonly FilterSlot[]): void {
  for (const slot of slots) {
    if (slot.origin !== undefined) {
      slot.origin[0] = 0;
      slot.origin[1] = 0;
    }
  }
}

/**
 * Draws a kept record live again, in this frame (P4.4): the loan of stage 2 ends, the filters go back onto the top,
 * the reason `"kept"` goes without a mark (the two halves draw the same pixels), the quad hides. Its textures stay.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view, `undefined` when it left.
 * @param putBack - False when the view is leaving: the release strips its filters anyway.
 */
export function goLive(
  kctx: KeptCtx,
  record: KeptRecord,
  view: View | undefined,
  putBack: boolean
): void {
  endLoan(record.s2Of);
  zeroOrigins(record.slots);

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  if (record.standIn !== undefined && !record.standIn.destroyed) record.standIn.filters = null;

  // Onto the view's top now: a view that got a wrapper while kept takes its filters on the new top.
  if (view !== undefined && putBack) {
    kctx.sync.applyFilters(view, filtersOf(kctx.ctx.state.sync, record.entity), noMark);
  }

  if (view !== undefined) kctx.sync.swapHidden(kctx.hidden, view, "kept", false);
  if (record.quad?.visible === true) record.quad.visible = false;

  ungroup(kctx, record);
  record.mode = "live";
  record.still = 0;
}

/**
 * Undoes the render group the cache made of a top that is drawn live again: drawn with its filters inside a parent's
 * filter pass, a top that stays a render group draws other pixels than the container it was (found by the browser
 * leg, T4). The next take makes it one again.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function ungroup(kctx: KeptCtx, record: KeptRecord): void {
  const { madeGroups } = kctx.state;

  if (!madeGroups.has(record.top)) return;

  if (!record.top.destroyed) record.top.disableRenderGroup();
  madeGroups.delete(record.top);
}

/**
 * The `before` of a filter write the cache makes: none marks, the frame is decided already and draws the same pixels.
 */
function noMark(): void {
  // The flush writes inside the render phase, after the decision: nothing to mark.
}

/**
 * Drops a record (P4.6): live first when kept, then every engine object and texture destroyed, the render group the
 * cache made undone, out of the maps and the list.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view, `undefined` when it left.
 * @param putBack - False when the view is leaving.
 */
export function dropRecord(
  kctx: KeptCtx,
  record: KeptRecord,
  view: View | undefined,
  putBack: boolean
): void {
  const { state } = kctx;

  if (record.mode === "kept") goLive(kctx, record, view, putBack);

  endLoan(record.s2Of);
  destroyRecord(record, texture => dropTexture(kctx, texture));

  if (state.madeGroups.has(record.top)) {
    if (!record.top.destroyed) record.top.disableRenderGroup();
    state.madeGroups.delete(record.top);
  }

  state.bytes -= record.bytes;
  record.bytes = 0;

  const at = state.records.indexOf(record);

  if (at !== -1) state.records.splice(at, 1);
  if (state.byEntity.get(record.entity) === record) state.byEntity.delete(record.entity);
  if (state.byTop.get(record.top) === record) state.byTop.delete(record.top);
}

/**
 * Writes the keys the next frames compare a live record with: the linear part and the stack resolution of this frame.
 *
 * @param record - The record.
 * @param now - This frame's numbers.
 */
function writeSeen(record: KeptRecord, now: Numbers): void {
  const { key } = record;

  key[KEY.seenA] = now.a;
  key[KEY.seenB] = now.b;
  key[KEY.seenC] = now.c;
  key[KEY.seenD] = now.d;
  key[KEY.seenRs] = now.rs;
}

/**
 * Tells whether this frame's linear part or stack resolution differs from the ones a set of keys holds.
 *
 * @param key - The record's key.
 * @param now - This frame's numbers.
 * @param base - The index of `a` in the set: `KEY.a` (the take) or `KEY.seenA` (the last frame).
 * @param rsAt - The index of the stack resolution in the set.
 * @returns True when one differs.
 */
function linearDiffers(key: Float64Array, now: Numbers, base: number, rsAt: number): boolean {
  return (
    key[base] !== now.a ||
    key[base + 1] !== now.b ||
    key[base + 2] !== now.c ||
    key[base + 3] !== now.d ||
    key[rsAt] !== now.rs
  );
}

/**
 * The bytes a take needs: the subtree picture, the filter output and the pre-pass results.
 *
 * @param record - The record.
 * @param now - This frame's numbers.
 * @param box - The picture's size, CSS px.
 * @param box.w1 - Width.
 * @param box.h1 - Height.
 * @param box.Ps - The padding on the grid.
 * @returns Bytes.
 */
function neededBytes(
  record: KeptRecord,
  now: Numbers,
  box: { w1: number; h1: number; Ps: number }
): number {
  const { w1, h1, Ps } = box;
  let bytes = textureBytes(w1, h1, now.rs) + textureBytes(w1 + 2 * Ps, h1 + 2 * Ps, now.r);
  const first = firstInputs(record.slots);

  if (first !== undefined) {
    for (let index = 0; index < first.inputs.count; index += 1) {
      const scale = first.inputs.scaleOf(index) ?? 0;

      bytes += textureBytes(w1 + 2 * now.P, h1 + 2 * now.P, now.rs * scale);
    }
  }

  return bytes;
}

/**
 * Hands the filters of a live record from its top to its stand-in, before stage 1 renders the top without them.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 */
function handFilters(kctx: KeptCtx, pixi: PixiModule, record: KeptRecord): void {
  const standIn = standInOf(pixi, record);

  kctx.sync.clearFilters(record.top);
  standIn.filters = filtersOf(kctx.ctx.state.sync, record.entity).map(slot => slot.filter);
}

/**
 * Takes or retakes the picture of a record: stages 1, 2 (when its first filter has inputs) and 3, at the phase of this
 * frame. Refused, and the view drawn live, for a `Display` in the subtree without `onDemand`, empty bounds, a picture
 * over 4096 device pixels, or a budget that has no room (P6.3, warned once).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 * @param now - This frame's numbers.
 * @returns True when every stage rendered.
 */
function takePicture(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  now: Numbers
): boolean {
  const { top, key } = record;

  if (!kctx.ctx.config.onDemand && holdsDisplay(kctx, top)) return false;

  const local = top.getLocalBounds();

  if (!(local.maxX > local.minX && local.maxY > local.minY)) return false;

  const box = linearBounds(now.a, now.b, now.c, now.d, local);
  const x = gridSpan(now.tx + box.x0, now.tx + box.x1, now.rs);
  const y = gridSpan(now.ty + box.y0, now.ty + box.y1, now.rs);
  const w1 = x.texels / now.rs;
  const h1 = y.texels / now.rs;
  const Ps = paddingOnGrid(now.P, now.rs);

  if (!fitsTexture(w1, h1, now.rs) || !fitsTexture(w1 + 2 * Ps, h1 + 2 * Ps, now.r)) return false;

  const needed = neededBytes(record, now, { w1, h1, Ps });

  if (
    !makeRoom(kctx, needed - record.bytes, record, kept =>
      goLive(kctx, kept, kctx.ctx.state.sync.views.get(kept.entity), true)
    )
  ) {
    record.refused = needed;
    warnRefused(kctx, labelOf(top));

    return false;
  }

  record.refused = 0;
  key[KEY.a] = now.a;
  key[KEY.b] = now.b;
  key[KEY.c] = now.c;
  key[KEY.d] = now.d;
  key[KEY.rs] = now.rs;
  key[KEY.tx] = now.tx;
  key[KEY.ty] = now.ty;
  key[KEY.X0] = x.first / now.rs;
  key[KEY.Y0] = y.first / now.rs;
  key[KEY.w1] = w1;
  key[KEY.h1] = h1;

  const live = record.mode === "live";

  if (live) handFilters(kctx, pixi, record);

  const first = firstInputs(record.slots);
  let ok = renderStage1(kctx, pixi, matrices, record);

  if (ok && first !== undefined) {
    renderStage2(kctx, pixi, matrices, record, {
      inputs: first.inputs,
      resolution: now.r,
      padding: now.P
    });
  } else if (record.s2Of !== undefined) {
    releaseInputs(kctx, record);
  }

  ok = ok && renderStage3(kctx, pixi, matrices, record, now);
  account(kctx, record);

  if (!ok && live) {
    // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
    if (record.standIn !== undefined) record.standIn.filters = null;
    kctx.sync.applyFilters(view, filtersOf(kctx.ctx.state.sync, record.entity), noMark, top);
  }

  record.settle = false;
  writeSeen(record, now);

  return ok;
}

/**
 * Ends the loan of stage 2 when the first filter with inputs left the stack: the results are destroyed.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function releaseInputs(kctx: KeptCtx, record: KeptRecord): void {
  endLoan(record.s2Of);
  record.s2Of = undefined;
  for (const target of record.s2.splice(0)) dropTexture(kctx, target);
}

/**
 * Brings the budget's count up to the record's textures as they are now.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function account(kctx: KeptCtx, record: KeptRecord): void {
  const bytes = bytesOf(record);

  kctx.state.bytes += bytes - record.bytes;
  record.bytes = bytes;
}

/**
 * Places the quad of a kept record (P3.5, P2.4): beside its top in the same parent, at the top's depth, drawing the
 * filter output at its canvas place `O + Δ` with an identity world scale; shown while the top is visible and no
 * cover or alpha hides it. Every value is compared before it is written.
 *
 * @param sync - The writers of `sync`: its reader of the hidden reasons.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 */
function placeQuad(
  sync: SyncWriters,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { top, key } = record;
  const parent = top.parent;
  const output = record.s3 ?? pixi.Texture.EMPTY;

  if (record.quad === undefined || record.quad.destroyed) {
    record.quad = new pixi.Sprite(output);
    record.quad.label = `kept:${labelOf(top)}`;
  }

  const quad = record.quad;

  if (quad.texture !== output) quad.texture = output;
  if (parent === null) return;

  if (quad.parent !== parent || parent.children[parent.getChildIndex(top) + 1] !== quad) {
    quad.removeFromParent();
    parent.addChildAt(quad, parent.getChildIndex(top) + 1);
  }

  if (quad.zIndex !== top.zIndex) quad.zIndex = top.zIndex;
  if (quad.blendMode !== top.blendMode) quad.blendMode = top.blendMode;

  const inverse = parent.getGlobalTransform(matrices.parent, false).invert();
  const Ps = key[KEY.Ps] ?? 0;
  const x = (key[KEY.X0] ?? 0) - Ps + NOW.tx - (key[KEY.tx] ?? 0);
  const y = (key[KEY.Y0] ?? 0) - Ps + NOW.ty - (key[KEY.ty] ?? 0);
  const { a, b, c, d } = inverse;
  const qtx = a * x + c * y + inverse.tx;
  const qty = b * x + d * y + inverse.ty;

  if (
    key[KEY.qa] !== a ||
    key[KEY.qb] !== b ||
    key[KEY.qc] !== c ||
    key[KEY.qd] !== d ||
    key[KEY.qtx] !== qtx ||
    key[KEY.qty] !== qty
  ) {
    matrices.local.set(a, b, c, d, qtx, qty);
    quad.setFromMatrix(matrices.local);
    key[KEY.qa] = a;
    key[KEY.qb] = b;
    key[KEY.qc] = c;
    key[KEY.qd] = d;
    key[KEY.qtx] = qtx;
    key[KEY.qty] = qty;
  }

  const visible = top.visible && !sync.hiddenBy(view, "alpha") && !sync.hiddenBy(view, "cover");

  if (quad.visible !== visible) quad.visible = visible;
}

/**
 * Shows the picture of a record that was just taken: the reason `"kept"` hides the top without a mark, the quad shows
 * in the same flush (K3).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 */
function toKept(kctx: KeptCtx, record: KeptRecord, view: View): void {
  record.mode = "kept";
  record.calm = false;
  record.churn = 0;
  kctx.sync.swapHidden(kctx.hidden, view, "kept", true);
}

/**
 * A live record's frame (P4.2): still frames are counted; at two (eight after churning) the record is taken.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 */
function stepLive(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { state } = kctx;
  const changed = record.dirtyS1 || linearDiffers(record.key, NOW, KEY.seenA, KEY.seenRs);

  writeSeen(record, NOW);
  record.still = changed ? 0 : record.still + 1;

  if (record.still < (record.calm ? CALM_AFTER : TAKE_AFTER)) return;
  // A refused take is not offered again until it fits (P6.3): no thrash.
  if (record.refused > 0 && state.bytes + record.refused - record.bytes > state.budget) return;

  if (takePicture(kctx, pixi, matrices, record, view, NOW)) toKept(kctx, record, view);
  else record.still = 0;
}

/**
 * A kept record's frame (P4.3): a stage-1 change retakes (three in a row go live and calm); otherwise a new chain
 * version redoes stages 2 and 3, a filter value, the resolution, the padding or (placed) a move stage 3; at rest after
 * an off-grid move one settle retake is owed.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 */
function stepKept(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { key } = record;

  if (record.dirtyS1 || linearDiffers(key, NOW, KEY.a, KEY.rs)) {
    record.churn += 1;

    if (record.churn >= CHURN_LIMIT) {
      goLive(kctx, record, view, true);
      record.calm = true;
      writeSeen(record, NOW);

      return;
    }

    if (!takePicture(kctx, pixi, matrices, record, view, NOW)) goLive(kctx, record, view, true);

    return;
  }

  record.churn = 0;

  const moved = NOW.tx !== key[KEY.lastTx] || NOW.ty !== key[KEY.lastTy];

  if (!moved && record.settle) {
    if (!takePicture(kctx, pixi, matrices, record, view, NOW)) goLive(kctx, record, view, true);

    return;
  }

  refresh(kctx, pixi, matrices, record);

  if (moved) {
    record.settle =
      !onGrid(NOW.tx - (key[KEY.tx] ?? 0), NOW.rs, NOW.r) ||
      !onGrid(NOW.ty - (key[KEY.ty] ?? 0), NOW.rs, NOW.r);

    // The settle retake happens at rest: a frame is asked for, in which the view stands where it is now.
    if (record.settle) kctx.demand.request();
  }
}

/**
 * Redoes stage 2 and 3, or stage 3 alone, when their keys changed (P4.3): a refresh never counts as churn.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 */
function refresh(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord
): void {
  const { key } = record;
  const first = firstInputs(record.slots);
  const inputs = first?.inputs;
  const s2 =
    inputs !== undefined &&
    (record.dirtyS2 ||
      inputs !== record.s2Of ||
      inputs.version() !== record.s2InputsVersion ||
      record.s1Version !== record.s2PictureVersion);
  const left = inputs === undefined && record.s2Of !== undefined;
  const s3 =
    s2 ||
    left ||
    record.dirtyS3 ||
    NOW.r !== key[KEY.r] ||
    NOW.P !== key[KEY.P] ||
    (record.category === "placed" && (NOW.tx !== key[KEY.s3Tx] || NOW.ty !== key[KEY.s3Ty]));

  if (left) releaseInputs(kctx, record);
  if (s2) renderStage2(kctx, pixi, matrices, record, { inputs, resolution: NOW.r, padding: NOW.P });
  if (!s3) return;

  renderStage3(kctx, pixi, matrices, record, NOW);
  account(kctx, record);
  if (!s2) kctx.state.refreshesOpen += 1;
}

/**
 * One drawn frame of a record, inside the flush: eligibility, the keys of this frame, the policy of its life, the quad
 * of a kept one; the dirty flags are cleared.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view, whose top is the record's.
 */
export function stepRecord(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { state, host } = kctx;
  const { key } = record;
  // What the record draws before this frame: a change of it is a change of every picture above it (P4.5).
  const mode = record.mode;
  const passes = state.flushPasses;
  const qtx = key[KEY.qtx];
  const qty = key[KEY.qty];
  const shown = record.quad?.visible === true && record.quad.parent !== null;

  NOW.r = host.resolution();
  readStack(record.slots, NOW.r, NOW);

  if (eligible(kctx, record, view, NOW)) {
    const world = record.top.getGlobalTransform(record.matrix, false);

    NOW.a = world.a;
    NOW.b = world.b;
    NOW.c = world.c;
    NOW.d = world.d;
    NOW.tx = world.tx;
    NOW.ty = world.ty;

    if (record.mode === "live") stepLive(kctx, pixi, matrices, record, view);
    else stepKept(kctx, pixi, matrices, record, view);

    if (record.mode === "kept") {
      placeQuad(kctx.sync, pixi, matrices, record, view);
      record.lastDrawn = state.frame;
      state.drawnPictures += 1;
    }

    key[KEY.lastTx] = NOW.tx;
    key[KEY.lastTy] = NOW.ty;
  } else {
    if (record.mode === "kept") goLive(kctx, record, view, true);

    record.still = 0;
  }

  if (
    mode !== record.mode ||
    passes !== state.flushPasses ||
    !Object.is(qtx, key[KEY.qtx]) ||
    !Object.is(qty, key[KEY.qty]) ||
    shown !== (record.quad?.visible === true && record.quad.parent !== null)
  ) {
    dirtyAbove(kctx, record);
  }

  record.dirtyS1 = false;
  record.dirtyS2 = false;
  record.dirtyS3 = false;
}

/**
 * Marks every record above a record as changed: its picture holds what this one drew, and the flush renders inner
 * records first, so they are retaken in the same flush (P4.5).
 *
 * @param kctx - The kept context.
 * @param record - The record whose drawing changed.
 */
function dirtyAbove(kctx: KeptCtx, record: KeptRecord): void {
  for (let node = record.top.parent; node !== null; node = node.parent) {
    const above = kctx.state.byTop.get(node);

    if (above !== undefined) above.dirtyS1 = true;
  }
}

/**
 * Puts a kept record's filters back on its top and hides its quad for an extract, or the other way back (P13.2): the
 * pixel leg draws every picture live once. No mark, no change of its life.
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param live - True to draw it live, false to draw its picture again.
 */
export function bypassRecord(kctx: KeptCtx, record: KeptRecord, view: View, live: boolean): void {
  const filters = filtersOf(kctx.ctx.state.sync, record.entity);

  if (live) {
    // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
    if (record.standIn !== undefined) record.standIn.filters = null;
    zeroOrigins(record.slots);
    kctx.sync.applyFilters(view, filters, noMark, record.top);
    kctx.sync.swapHidden(kctx.hidden, view, "kept", false);
    if (record.quad !== undefined) record.quad.visible = false;
    // Drawn live, the top must not stay the render group its picture made of it.
    ungroup(kctx, record);

    return;
  }

  kctx.sync.clearFilters(record.top);
  if (record.standIn !== undefined) record.standIn.filters = filters.map(slot => slot.filter);
  kctx.sync.swapHidden(kctx.hidden, view, "kept", true);
  if (record.quad !== undefined) {
    record.quad.visible =
      record.top.visible &&
      !kctx.sync.hiddenBy(view, "alpha") &&
      !kctx.sync.hiddenBy(view, "cover");
  }
}
