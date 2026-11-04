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
import type { OverlayRecord, SyncCtx } from "./types";
import { applyHud } from "./views";

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

  for (const record of order) factor += (keeps(record, key) - factor) * record.level;

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

  for (const record of order) if (record.phase !== "exiting") target = keeps(record, key);

  return target;
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

  for (const node of list) if (!set.has(node)) return false;

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
  for (const top of offList) next.add(top);

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

/**
 * The HUD parts: every part of the HUD layer is drawn with the factor of the overlays' levels of this frame, and the
 * parts leaving or not fully back take no tap. A part outside the HUD layer is warned once and drawn as it is. A part of
 * a scene built aside is not warned while it builds, nor in the frame its build waits to be attached: the layers it is
 * judged against are still the scene's being left (a splash with no HUD layer), or none on a cold page (F117).
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepParts(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;

  if (overlay.parts.size === 0 && overlay.offTops.size === 0) return;

  // per frame: the HUD layer's name kept with the layers, no walk of the layer table.
  const hud = state.hudLayer;
  // A build committed after this frame's pass: its layers and its held views come with the next one.
  const settling = heldWaiting(sctx);
  const ecs = sctx.ctx.deps.world.ecs;
  const projection = sctx.ctx.deps.world.projection;

  // per frame: the faded tops written in place into the reused list, the tap set touched only when they change.
  const { offList } = overlay;
  let count = 0;

  for (const entity of overlay.parts) {
    const view = state.views.get(entity);

    if (view === undefined) continue;

    const key = ecs.get(entity, HudPart)?.key ?? "";

    if (hud === undefined || layerOf(sctx, entity) !== hud) {
      // A part of a build is judged once its scene's layers stand: a HUD part is not outside a layer list not yet its own.
      const building = settling || projection.isBuilding(entity);

      if (!building) warnOutside(sctx, entity, key);
      applyHud(sctx, entity, view, 1);

      continue;
    }

    const factor = factorOf(overlay.order, key);

    applyHud(sctx, entity, view, factor);

    if (factor < 1 || targetOf(overlay.order, key) < 1) {
      const top = view.wrapper ?? view.object;

      if (offList[count] !== top) offList[count] = top;
      count += 1;
    }
  }

  keepOff(sctx, count);
}
