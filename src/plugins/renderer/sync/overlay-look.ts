/**
 * @file renderer/sync — what the overlay step draws itself: the dim of an overlay, one full-screen quad right under
 * its root (O6), the render layer right under the dim an overlay with `hud: "under"` draws the HUD layer in (F147), and
 * the HUD parts an overlay keeps or lets fade, written in the same step as the level they follow (O7, K3).
 */
import type { Entity } from "../../world/types";
import { HudPart } from "../components";
import type { DemandReason } from "../demand/types";
import type { PixiContainer, PixiModule, PixiRenderLayer, PixiSprite } from "../types";
import { layerOf } from "./bounds";
import { heldWaiting } from "./build";
import { poseOf, restPose, returnOf } from "./overlay-return";
import type { OverlayRecord, OverlayState, SyncCtx } from "./types";
import { applyHud, applyHudTop, applyHudTurn, writeHudPose } from "./views";

/**
 * The pose of the part being stepped (F245): the walks of the runs that hold it, sampled into it in place, one part at a
 * time; never allocated in a frame.
 */
const POSE = new Float64Array(6);

/** The factor of the part being stepped while a return is in progress: the overlays' levels times the returns (F245). */
const FACTOR = new Float64Array(1);

/**
 * Makes the dim of one overlay: a sprite of Pixi's white texture, never a view.
 *
 * @param pixi - The Pixi module.
 * @param entity - The marked entity, for the label.
 * @returns The dim.
 */
function makeDim(pixi: PixiModule, entity: Entity): PixiSprite {
  const dim = new pixi.Sprite(pixi.Texture.WHITE);

  dim.label = `overlay-dim:${entity}`;

  return dim;
}

/**
 * Places a dim in its record's layer container immediately before the overlay's root, at the root's depth, so Pixi's
 * stable sort keeps it right under the root. A move marks the whole frame: the dim has no entity.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @param dim - Its dim.
 */
function placeDim(sctx: SyncCtx, record: OverlayRecord, dim: PixiSprite): void {
  const { container, object } = record;
  const at = container.getChildIndex(object);

  if (dim.parent !== container || container.children[at - 1] !== dim) {
    sctx.deps.demand.whole("overlay");
    dim.removeFromParent();
    container.addChildAt(dim, container.getChildIndex(object));
  }

  if (dim.zIndex !== object.zIndex) {
    sctx.deps.demand.whole("overlay");
    dim.zIndex = object.zIndex;
  }
}

/**
 * Sizes a dim to the canvas in its layer container's own space: the two corners of the screen through `toLocal`.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @param dim - Its dim.
 */
function sizeDim(sctx: SyncCtx, record: OverlayRecord, dim: PixiSprite): void {
  const screen = sctx.deps.host.screen();

  if (screen === undefined) return;

  const start = record.container.toLocal({ x: 0, y: 0 });
  const end = record.container.toLocal({ x: screen.width, y: screen.height });
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (dim.x !== x || dim.y !== y || dim.width !== width || dim.height !== height) {
    sctx.deps.demand.whole("overlay");
    dim.position.set(x, y);
    dim.width = width;
    dim.height = height;
  }

  record.sized = true;
}

/**
 * Writes the look of a dim: its colour, `dim × level`, and shown only while that is above 0 and the overlay does not
 * cover the screen itself. Each field only when it differs.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @param dim - Its dim.
 */
function lookDim(sctx: SyncCtx, record: OverlayRecord, dim: PixiSprite): void {
  const alpha = record.value.dim * record.level;
  const visible = alpha > 0 && record.mode !== "cover";

  if (dim.tint !== record.value.dimColor) {
    sctx.deps.demand.whole("overlay");
    dim.tint = record.value.dimColor;
  }

  if (dim.alpha !== alpha) {
    sctx.deps.demand.whole("overlay");
    dim.alpha = alpha;
  }

  if (dim.visible !== visible) {
    sctx.deps.demand.whole("overlay");
    dim.visible = visible;
  }
}

/**
 * Makes the render layer an overlay with `hud: "under"` draws the HUD layer in: never a view, nothing attached yet.
 *
 * @param pixi - The Pixi module.
 * @param entity - The marked entity, for the label.
 * @returns The render layer.
 */
function makeUnder(pixi: PixiModule, entity: Entity): PixiRenderLayer {
  const under = new pixi.RenderLayer();

  under.label = `overlay-hud:${entity}`;

  return under;
}

/**
 * Places an overlay's HUD render layer immediately before its dim, at the dim's depth, as the dim is placed before the
 * root: what it draws lies under the dim, and a picture of the range stands right before it. A move marks the whole
 * frame: the layer has no entity.
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 * @param under - Its render layer.
 * @param dim - Its dim, placed already.
 */
function placeUnder(
  sctx: SyncCtx,
  record: OverlayRecord,
  under: PixiRenderLayer,
  dim: PixiSprite
): void {
  const { container } = record;
  const at = container.getChildIndex(dim);

  if (under.parent !== container || container.children[at - 1] !== under) {
    sctx.deps.demand.whole("overlay");
    under.removeFromParent();
    container.addChildAt(under, container.getChildIndex(dim));
  }

  if (under.zIndex !== dim.zIndex) {
    sctx.deps.demand.whole("overlay");
    under.zIndex = dim.zIndex;
  }
}

/**
 * The dims of every overlay with a dim above 0: made once, placed under the root, sized to the canvas (again after a
 * resize, a resolution change or a restore), and their look written; the HUD render layer of one with `hud: "under"`
 * made with its dim and placed right under it (U1). A dim of 0 makes neither (U6).
 *
 * @param sctx - Domain context of the sync module.
 * @param wholes - The whole-frame reasons of this decision.
 */
export function stepDims(sctx: SyncCtx, wholes: ReadonlySet<DemandReason>): void {
  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return;

  const resized = wholes.has("resize") || wholes.has("restore");

  for (const record of sctx.ctx.state.sync.overlay.order) {
    if (record.dim === undefined) {
      if (record.value.dim <= 0) continue;

      record.dim = makeDim(pixi, record.entity);
      record.sized = false;
    }

    placeDim(sctx, record, record.dim);
    if (resized || !record.sized) sizeDim(sctx, record, record.dim);
    lookDim(sctx, record, record.dim);

    if (needsUnder(record)) record.under = makeUnder(pixi, record.entity);
    if (record.under !== undefined) placeUnder(sctx, record, record.under, record.dim);
  }
}

/**
 * Tells whether an overlay wants a HUD render layer it does not have yet: `hud: "under"` with a dim above 0 (U1, U6).
 *
 * @param record - The overlay.
 * @returns True when the layer is to be made.
 */
function needsUnder(record: OverlayRecord): boolean {
  return record.under === undefined && record.value.hud === "under" && record.value.dim > 0;
}

/**
 * Tells whether an overlay holds the HUD under its dim now, if nothing above it does: its render layer is made, it says
 * `hud: "under"`, and its dim and its level are above 0.
 *
 * @param record - The overlay.
 * @returns True when it can hold the HUD.
 */
function isUnderHolder(record: OverlayRecord): boolean {
  const { value } = record;

  return record.under !== undefined && value.hud === "under" && value.dim > 0 && record.level > 0;
}

/**
 * The render layer the HUD layer is drawn in now (U2): the topmost overlay with `hud: "under"`, a dim above 0 and a
 * level above 0, looked for from the top down to the overlay that owns the range. One under that owner holds nothing:
 * it lies in the owner's picture, which would cover a HUD drawn under it.
 *
 * @param order - The overlays, bottom first, their modes decided.
 * @returns The holder's render layer, or `undefined` while the HUD draws in its own place above the overlays.
 */
function holderOf(order: readonly OverlayRecord[]): PixiRenderLayer | undefined {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const record = order[index];

    if (record === undefined) continue;
    if (isUnderHolder(record)) return record.under;

    // The owner of the range: everything under it is in its picture.
    if (record.mode !== "live") return undefined;
  }

  return undefined;
}

/**
 * Lets the HUD layer container go from the render layer that holds it, so it draws in its own place again. Only a
 * container still attached there is detached: Pixi already let go of one that left its parent.
 *
 * @param sctx - Domain context of the sync module.
 */
function letGoHud(sctx: SyncCtx): void {
  const overlay = sctx.ctx.state.sync.overlay;
  const { held, heldBy } = overlay;

  overlay.held = undefined;
  overlay.heldBy = undefined;

  if (held === undefined || heldBy === undefined) return;

  if (held.parentRenderLayer === heldBy) heldBy.detach(held);
  sctx.deps.demand.whole("overlay");
}

/**
 * Hands the HUD layer container to the overlay that holds it under its dim this frame, or back to its own place (U2):
 * the old holder lets it go before the new one takes it, and either marks the whole frame. A frame where nothing
 * changed compares references and writes nothing. The HUD is held only while its container hangs in the stage root,
 * in the one render group of the layers.
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepHold(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;
  const name = state.hudLayer;
  const container = name === undefined ? undefined : state.layers.get(name)?.container;
  // The HUD can be held only while its container hangs in the stage root, in the render group of the layers.
  const holdable = container !== undefined && container.parent === state.root;
  const holder = holdable ? holderOf(overlay.order) : undefined;
  // per frame: the holder, the container and Pixi's own link compared, nothing written while they stand.
  const unchanged =
    holder === overlay.heldBy &&
    container === overlay.held &&
    container?.parentRenderLayer === holder;

  if (holder === undefined && overlay.heldBy === undefined) return;
  if (unchanged) return;

  letGoHud(sctx);

  if (holder === undefined || container === undefined) return;

  holder.attach(container);
  overlay.held = container;
  overlay.heldBy = holder;
  sctx.deps.demand.whole("overlay");
}

/**
 * Destroys an overlay's HUD render layer, the HUD let go first when it holds it, so nothing is left attached (U5).
 *
 * @param sctx - Domain context of the sync module.
 * @param record - The overlay.
 */
export function dropUnder(sctx: SyncCtx, record: OverlayRecord): void {
  const { under } = record;

  if (under === undefined) return;

  if (sctx.ctx.state.sync.overlay.heldBy === under) letGoHud(sctx);

  sctx.deps.demand.whole("overlay");
  under.detachAll();
  if (!under.destroyed) under.destroy();
  record.under = undefined;
}

/**
 * Destroys the HUD render layer of every overlay, for new layers: the next step of the frame makes them again where
 * the records hang now (U5).
 *
 * @param sctx - Domain context of the sync module.
 */
export function dropUnders(sctx: SyncCtx): void {
  for (const record of sctx.ctx.state.sync.overlay.records.values()) dropUnder(sctx, record);
}

/**
 * Whether one overlay keeps a HUD part shown: 1 for `hud: "all"` and `"under"` (the whole HUD stays, under the dim), 0
 * for `"none"`, and whether its list holds the key.
 *
 * @param record - The overlay.
 * @param key - The part's key.
 * @returns 1 or 0.
 */
function keeps(record: OverlayRecord, key: string): number {
  const { hud } = record.value;

  if (hud === "all" || hud === "under") return 1;
  if (hud === "none") return 0;

  return hud.includes(key) ? 1 : 0;
}

/**
 * The factor a part is drawn with: the overlays bottom first, each blending its keep over the one below by its own
 * level, so the topmost decides as it comes and goes.
 *
 * @param order - The overlays, bottom first.
 * @param key - The part's key.
 * @returns The factor, 0 to 1.
 */
function factorOf(order: readonly OverlayRecord[], key: string): number {
  let factor = 1;

  // per frame and part: the order is walked by index, `for…of` makes an iterator in the unoptimized tiers.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < order.length; index += 1) {
    const record = order[index];

    if (record !== undefined) factor += (keeps(record, key) - factor) * record.level;
  }

  return factor;
}

/**
 * Where a part is going: the keep of the topmost overlay that is not leaving, 1 with none.
 *
 * @param order - The overlays, bottom first.
 * @param key - The part's key.
 * @returns 1 or 0.
 */
function targetOf(order: readonly OverlayRecord[], key: string): number {
  let target = 1;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < order.length; index += 1) {
    const record = order[index];

    if (record !== undefined && record.phase !== "exiting") target = keeps(record, key);
  }

  return target;
}

/**
 * Whether a part is inert: an overlay in the order, in any phase, keeps it shown and says `hudInert`. `"under"` and
 * `"none"` keep nothing inert.
 *
 * @param order - The overlays, bottom first.
 * @param key - The part's key.
 * @returns True when a tap does not reach the part.
 */
function inertOf(order: readonly OverlayRecord[], key: string): boolean {
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < order.length; index += 1) {
    const record = order[index];

    if (record === undefined) continue;

    const { hud, hudInert } = record.value;

    if (!hudInert || hud === "none" || hud === "under") continue;
    if (hud === "all" || hud.includes(key)) return true;
  }

  return false;
}

/**
 * Tells whether a set holds exactly the nodes of a list: as many, and every one of them.
 *
 * @param list - The nodes, each once.
 * @param set - The set.
 * @returns True when they are the same nodes.
 */
function holdsSame(list: readonly PixiContainer[], set: ReadonlySet<PixiContainer>): boolean {
  if (list.length !== set.size) return false;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < list.length; index += 1) {
    const node = list[index];

    if (node !== undefined && !set.has(node)) return false;
  }

  return true;
}

/**
 * Makes the tap set hold the faded tops of this frame, the first `count` of `offList`, only when they differ from it:
 * the set is built aside and swapped in, so a frame where nothing changed clears nothing (V8 gives a set a new table at
 * every `clear()`, and the step runs every frame).
 *
 * @param sctx - Domain context of the sync module.
 * @param count - How many tops `offList` holds this frame.
 */
function keepOff(sctx: SyncCtx, count: number): void {
  const overlay = sctx.ctx.state.sync.overlay;
  const { offList } = overlay;

  offList.length = count;

  if (holdsSame(offList, overlay.offTops)) return;

  const next = overlay.nextOff;

  if (next.size > 0) next.clear();
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < offList.length; index += 1) {
    const top = offList[index];

    if (top !== undefined) next.add(top);
  }

  overlay.nextOff = overlay.offTops;
  overlay.offTops = next;
}

/**
 * Logs one warning of a part once, in dev builds.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The part.
 * @param key - Its key.
 */
function warnOutside(sctx: SyncCtx, entity: Entity, key: string): void {
  if (!(typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__)) return;

  const warned = sctx.ctx.state.sync.overlay.warned;
  const code = `hud-part-outside:${entity}`;

  if (warned.has(code)) return;

  warned.add(code);
  sctx.ctx.log.warn("renderer:hud-part-outside", { entity, key });
}

/** What the walk of the HUD parts reads, set before the walk: one at a time, no closure per frame. */
const partsWalk: {
  sctx: SyncCtx | undefined;
  hud: string | undefined;
  settling: boolean;
  count: number;
  /** A part took a new pose in this frame's walk of `posePart` (F245): the parts are drawn after it. */
  posed: boolean;
} = { sctx: undefined, hud: undefined, settling: false, count: 0, posed: false };

/**
 * Poses one HUD part of the walk (F245): at the pose of the walks of the returns that hold it, at rest with no run and
 * outside the HUD layer (a walk it was in leaves no pose on it), into its view's numbers, and notes on its view whether
 * a walk still moves it, for the tap rule of `stepPart`. Draws nothing: `drawPart` does, in a walk of its own.
 *
 * @param entity - The part.
 */
function posePart(entity: Entity): void {
  const { sctx, hud } = partsWalk;

  if (sctx === undefined) return;

  const state = sctx.ctx.state.sync;
  const view = state.views.get(entity);

  if (view === undefined) return;

  const { returns } = state.overlay;

  // Rest with no run: a compare of six numbers once it stands there.
  restPose(POSE);

  // Only a part of the HUD layer, with a run in progress, is walked.
  const canWalk = returns.length > 0 && hud !== undefined && layerOf(sctx, entity) === hud;

  view.hudWalking =
    canWalk && poseOf(returns, sctx.ctx.deps.world.ecs.get(entity, HudPart)?.key ?? "", POSE);

  if (writeHudPose(view, POSE)) partsWalk.posed = true;
}

/**
 * Draws one HUD part at the pose its view's numbers hold (F245), in a frame where a part took a new pose: a compare for
 * a part that did not. Each part walk is a `forEach` callback, so V8 compiles each on its own: the walk that samples the
 * poses is too large for it to inline the Pixi writes as well, and a fraction handed to one it does not inline is boxed
 * (measured, 16 B a number); in a callback this small they are inlined.
 *
 * @param entity - The part.
 */
function drawPart(entity: Entity): void {
  const { sctx } = partsWalk;

  if (sctx === undefined) return;

  const view = sctx.ctx.state.sync.views.get(entity);

  if (view !== undefined) applyHudTop(sctx, entity, view);
}

/**
 * Turns one HUD part to the rotation its view's numbers hold (F245), in a frame where a part took a new pose: a walk of
 * its own, as `drawPart`'s, since V8 inlines Pixi's rotation setter only into a callback this small (measured).
 *
 * @param entity - The part.
 */
function turnPart(entity: Entity): void {
  const { sctx } = partsWalk;

  if (sctx === undefined) return;

  const view = sctx.ctx.state.sync.views.get(entity);

  if (view !== undefined) applyHudTurn(view);
}

/**
 * The walks of the poses (F245), before the step of the parts, so its tap rule reads whether a walk still moves a part.
 * A frame with no run whose parts the last walk put at rest walks none of them: a frame with no return costs what it
 * cost before F245.
 *
 * @param overlay - The overlay step's state.
 */
function stepPoses(overlay: OverlayState): void {
  const hasRuns = overlay.returns.length > 0;

  if (!hasRuns && overlay.posesAtRest) return;

  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, no iterator.
  overlay.parts.forEach(posePart);
  // A walk with no run put every part at rest and noted none walking: the next one with no run is skipped.
  overlay.posesAtRest = !hasRuns;

  if (!partsWalk.posed) return;

  partsWalk.posed = false;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, no iterator.
  overlay.parts.forEach(drawPart);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, no iterator.
  overlay.parts.forEach(turnPart);
}

/**
 * Steps one HUD part of the walk: judged against the HUD layer, faded by the factor of the overlays, and noted in the
 * list of the tops that take no tap when it fades, is going to fade, still walks (F245, as `posePart` noted), or is
 * kept by an inert overlay.
 *
 * @param entity - The part.
 */
function stepPart(entity: Entity): void {
  const { sctx, hud, settling } = partsWalk;

  if (sctx === undefined) return;

  // The part's view and key; a part with no view yet is not stepped.
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;
  const view = state.views.get(entity);

  if (view === undefined) return;

  const key = sctx.ctx.deps.world.ecs.get(entity, HudPart)?.key ?? "";
  const isOutsideHud = hud === undefined || layerOf(sctx, entity) !== hud;

  // A part outside the HUD layer: warned (not while it builds) and drawn as it is.
  if (isOutsideHud) {
    // A part of a build is judged once its scene's layers stand: a HUD part is not outside a layer list not yet its own.
    const building = settling || sctx.ctx.deps.world.projection.isBuilding(entity);

    if (!building) warnOutside(sctx, entity, key);
    applyHud(sctx, entity, view, 1);

    return;
  }

  // The overlays' levels, times every return of the HUD in progress (F240): 1 with none. The returns multiply into a
  // cell: a fraction returned by a call V8 does not inline is boxed. With none no cell is read: a read of a
  // `Float64Array` boxes its number in the cold tiers.
  let factor = factorOf(overlay.order, key);

  if (overlay.returns.length > 0) {
    FACTOR[0] = factor;
    returnOf(overlay.returns, key, FACTOR);
    factor = FACTOR[0] ?? 1;
  }

  applyHud(sctx, entity, view, factor);

  // The tap rule, in the order the terms cost: fading, still walking, going to fade, kept by an inert overlay.
  const isUntappable =
    factor < 1 ||
    view.hudWalking ||
    targetOf(overlay.order, key) < 1 ||
    inertOf(overlay.order, key);

  // An untappable part's top joins this frame's list of tops that take no tap, written in place.
  if (isUntappable) {
    const top = view.wrapper ?? view.object;
    const { offList } = overlay;

    if (offList[partsWalk.count] !== top) offList[partsWalk.count] = top;
    partsWalk.count += 1;
  }
}

/**
 * The HUD parts: every part of the HUD layer is drawn with the factor of the overlays' levels of this frame times the
 * returns in progress (F240) and at the pose of their walks (F245), and the parts leaving, not fully back or still
 * walking take no tap, and the parts an inert overlay keeps shown take no tap either. A part outside the HUD layer is
 * warned once and drawn as it is. A part of a scene built aside is not warned while it builds, nor in the frame its
 * build waits to be attached: the layers it is judged against are still the scene's being left (a splash with no HUD
 * layer), or none on a cold page (F117).
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepParts(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;

  if (overlay.parts.size === 0 && overlay.offTops.size === 0) return;

  // per frame: the HUD layer's name kept with the layers, no walk of the layer table.
  partsWalk.sctx = sctx;
  partsWalk.hud = state.hudLayer;
  // A build committed after this frame's pass: its layers and its held views come with the next one.
  partsWalk.settling = heldWaiting(sctx);
  // per frame: the faded tops written in place into the reused list, the tap set touched only when they change.
  partsWalk.count = 0;
  // per frame: a Set walked with `forEach` and a callback made once, no iterator and no result objects.
  stepPoses(overlay);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, no iterator.
  overlay.parts.forEach(stepPart);

  const count = partsWalk.count;

  partsWalk.sctx = undefined;
  partsWalk.hud = undefined;
  keepOff(sctx, count);
}
