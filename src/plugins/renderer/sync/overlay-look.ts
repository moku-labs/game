/**
 * @file renderer/sync — what the overlay step draws itself: the dim of an overlay, one full-screen quad right under
 * its root (O6), and the HUD parts an overlay keeps or lets fade, written in the same step as the level they follow
 * (O7, K3).
 */
import type { Entity } from "../../world/types";
import { HudPart } from "../components";
import type { DemandReason } from "../demand/types";
import type { PixiContainer, PixiModule, PixiSprite } from "../types";
import { layerOf } from "./bounds";
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
 * The dims of every overlay with a dim above 0: made once, placed under the root, sized to the canvas (again after a
 * resize, a resolution change or a restore), and their look written.
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
  }
}

/**
 * Whether one overlay keeps a HUD part shown: 1 for `hud: "all"`, 0 for `"none"`, and whether its list holds the key.
 *
 * @param record - The overlay.
 * @param key - The part's key.
 * @returns 1 or 0.
 */
function keeps(record: OverlayRecord, key: string): number {
  const { hud } = record.value;

  if (hud === "all") return 1;
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
 * Tells whether two sets hold the same nodes.
 *
 * @param left - One set.
 * @param right - The other.
 * @returns True when they are equal.
 */
function sameSet(left: ReadonlySet<PixiContainer>, right: ReadonlySet<PixiContainer>): boolean {
  if (left.size !== right.size) return false;

  for (const node of left) if (!right.has(node)) return false;

  return true;
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
 * parts leaving or not fully back take no tap. A part outside the HUD layer is warned once and drawn as it is. Before the
 * first layers exist (a scene built aside on a cold page, committed after this frame's pass) no part is warned (F117).
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepParts(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;

  if (overlay.parts.size === 0 && overlay.offTops.size === 0) return;

  // per frame: the HUD layer's name kept with the layers, no walk of the layer table.
  const hud = state.hudLayer;
  // A scene committed after this frame's pass has no layers until the next one: no part is outside a HUD layer yet.
  const layered = (state.layerList?.length ?? 0) > 0;
  const ecs = sctx.ctx.deps.world.ecs;

  // Only when it holds something: V8 gives an empty set a new table at every `clear()`, and the step runs every frame.
  if (overlay.nextOff.size > 0) overlay.nextOff.clear();

  for (const entity of overlay.parts) {
    const view = state.views.get(entity);

    if (view === undefined) continue;

    const key = ecs.get(entity, HudPart)?.key ?? "";

    if (hud === undefined || layerOf(sctx, entity) !== hud) {
      if (layered) warnOutside(sctx, entity, key);
      applyHud(sctx, entity, view, 1);

      continue;
    }

    const factor = factorOf(overlay.order, key);

    applyHud(sctx, entity, view, factor);

    if (factor < 1 || targetOf(overlay.order, key) < 1) {
      overlay.nextOff.add(view.wrapper ?? view.object);
    }
  }

  if (!sameSet(overlay.offTops, overlay.nextOff)) {
    const next = overlay.nextOff;

    overlay.nextOff = overlay.offTops;
    overlay.offTops = next;
  }
}
