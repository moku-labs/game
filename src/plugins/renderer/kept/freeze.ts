/**
 * @file renderer/kept — the range pictures of overlays (P7), the seam spec 22 drives by its names: `take`, `retake`,
 * `move`, `release`, `kept`, `sprite`. Spec 22 decides the range, its reasons and its retakes; this module renders the
 * picture (one render of the stage root, with only the range drawn), places its sprite and keeps it in the budget.
 */
import type { Entity } from "../../world/types";
import type { PixiModule, PixiSprite } from "../types";
import { makeRoom } from "./budget";
import { textureBytes } from "./geometry";
import { canKeep, dropTexture, fitTexture, matricesOf } from "./render";
import type { KeptCtx, KeptMatrices, KeptRange, KeptRecord, RangeRecord } from "./types";

/**
 * The bytes a range picture of the canvas holds at the renderer resolution.
 *
 * @param kctx - The kept context.
 * @returns Bytes, or 0 while nothing draws.
 */
function canvasBytes(kctx: KeptCtx): number {
  const screen = kctx.host.screen();

  return screen === undefined
    ? 0
    : textureBytes(screen.width, screen.height, kctx.host.resolution());
}

/**
 * Places a range's sprite immediately before `slot.before` in `slot.container`, at its depth, covering the canvas in
 * that container's space: `inverse(container.getGlobalTransform())`. Compared before every write.
 *
 * @param matrices - The scratch matrices.
 * @param range - The range record, its sprite made.
 */
function placeSprite(matrices: KeptMatrices, range: RangeRecord): void {
  const { sprite, slot } = range;

  if (sprite === undefined) return;

  const { container, before } = slot;

  if (before.parent === container) {
    const at = container.getChildIndex(before);

    if (sprite.parent !== container || container.children[at - 1] !== sprite) {
      sprite.removeFromParent();
      container.addChildAt(sprite, container.getChildIndex(before));
    }
  } else if (sprite.parent !== container) {
    sprite.removeFromParent();
    container.addChild(sprite);
  }

  if (sprite.zIndex !== before.zIndex) sprite.zIndex = before.zIndex;

  const inverse = container.getGlobalTransform(matrices.parent, false).invert();
  const { local } = range;

  if (
    local[0] !== inverse.a ||
    local[1] !== inverse.b ||
    local[2] !== inverse.c ||
    local[3] !== inverse.d ||
    local[4] !== inverse.tx ||
    local[5] !== inverse.ty
  ) {
    sprite.setFromMatrix(inverse);
    local[0] = inverse.a;
    local[1] = inverse.b;
    local[2] = inverse.c;
    local[3] = inverse.d;
    local[4] = inverse.tx;
    local[5] = inverse.ty;
  }

  range.moved = false;
}

/**
 * The picture of a range at the canvas size: the spare a released range left when it fits, otherwise a new texture.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param range - The range record.
 * @returns The texture.
 */
function pictureOf(kctx: KeptCtx, pixi: PixiModule, range: RangeRecord): RangeRecord["picture"] {
  const screen = kctx.host.screen();

  if (screen === undefined) return range.picture;

  if (range.picture === undefined && kctx.state.spare !== undefined) {
    range.picture = kctx.state.spare;
    range.bytes = textureBytes(
      range.picture.source.width,
      range.picture.source.height,
      range.picture.source.resolution
    );
    kctx.state.spare = undefined;
  }

  range.picture = fitTexture(
    kctx,
    pixi,
    range.picture,
    { width: screen.width, height: screen.height, resolution: kctx.host.resolution() },
    `freeze:${range.id}`
  );

  const bytes = canvasBytes(kctx);

  kctx.state.bytes += bytes - range.bytes;
  range.bytes = bytes;

  return range.picture;
}

/**
 * Takes the picture of a range (P7.3): makes or reuses the record of the id (a take of a held id is a retake), copies
 * the entries and the others, places the sprite and owes a render in this frame's flush. Answers false and places
 * nothing with the switch off, while nothing draws, and when the picture does not fit the budget after eviction.
 *
 * @param kctx - The kept context.
 * @param range - What spec 22 hands over.
 * @param goLive - Draws an evicted record live.
 * @returns True when the range is kept.
 */
export function takeRange(
  kctx: KeptCtx,
  range: KeptRange,
  goLive: (record: KeptRecord) => void
): boolean {
  const { state } = kctx;
  const pixi = kctx.host.pixi();
  const matrices = matricesOf(kctx);

  if (!state.on || !kctx.host.ready() || !canKeep(pixi) || matrices === undefined) return false;

  let record = state.ranges.get(range.id);
  const held = record?.bytes ?? (state.spare === undefined ? 0 : canvasBytes(kctx));

  if (!makeRoom(kctx, canvasBytes(kctx) - held, undefined, goLive)) return false;

  if (record === undefined) {
    record = {
      id: range.id,
      entries: [],
      others: [],
      slot: { container: range.slot.container, before: range.slot.before },
      picture: undefined,
      sprite: undefined,
      due: true,
      moved: true,
      lastDrawn: state.frame,
      bytes: 0,
      local: new Float64Array(6).fill(Number.NaN)
    };
    state.ranges.set(range.id, record);
  }

  record.entries.splice(0, record.entries.length, ...range.entries);
  record.others.splice(0, record.others.length, ...range.others);
  record.slot = { container: range.slot.container, before: range.slot.before };
  record.due = true;

  const picture = pictureOf(kctx, pixi, record) ?? pixi.Texture.EMPTY;

  if (record.sprite === undefined || record.sprite.destroyed) {
    record.sprite = new pixi.Sprite(picture);
    record.sprite.label = `freeze:${range.id}`;
    record.local.fill(Number.NaN);
  } else if (record.sprite.texture !== picture) {
    record.sprite.texture = picture;
  }

  if (!record.others.includes(record.sprite)) record.others.push(record.sprite);
  placeSprite(matrices, record);

  return true;
}

/**
 * Owes a render of a range's picture in this frame's flush (P7.4); an unknown id is a no-op.
 *
 * @param kctx - The kept context.
 * @param id - The overlay's entity.
 */
export function retakeRange(kctx: KeptCtx, id: Entity): void {
  const record = kctx.state.ranges.get(id);

  if (record !== undefined) record.due = true;
}

/**
 * Places a range's sprite in another slot, in this frame (P7.4); an unknown id is a no-op.
 *
 * @param kctx - The kept context.
 * @param id - The overlay's entity.
 * @param slot - Where the picture draws now.
 */
export function moveRange(kctx: KeptCtx, id: Entity, slot: KeptRange["slot"]): void {
  const record = kctx.state.ranges.get(id);
  const matrices = matricesOf(kctx);

  if (record === undefined || matrices === undefined) return;

  record.slot = { container: slot.container, before: slot.before };
  record.moved = true;
  placeSprite(matrices, record);
}

/**
 * Lets a range's picture go, in this frame (P7.4): the sprite leaves the tree, the record goes, its texture becomes the
 * spare (or is destroyed when a spare is held already). An unknown id is a no-op.
 *
 * @param kctx - The kept context.
 * @param id - The overlay's entity.
 */
export function releaseRange(kctx: KeptCtx, id: Entity): void {
  const { state } = kctx;
  const record = state.ranges.get(id);

  if (record === undefined) return;

  state.ranges.delete(id);
  record.sprite?.destroy();
  record.sprite = undefined;

  if (record.picture === undefined) return;

  if (state.spare === undefined) {
    state.spare = record.picture;
  } else {
    dropTexture(kctx, record.picture);
    state.bytes -= record.bytes;
  }

  record.picture = undefined;
}

/**
 * The sprite of a range's picture, by reference, so spec 22 leaves it out of every range (P7.7).
 *
 * @param kctx - The kept context.
 * @param id - The overlay's entity.
 * @returns The sprite, or `undefined` for an unknown id.
 */
export function spriteOf(kctx: KeptCtx, id: Entity): PixiSprite | undefined {
  return kctx.state.ranges.get(id)?.sprite;
}

/**
 * Renders the picture of one range: one render of the stage root, inside `liftFor` (the entries hidden only by
 * `"freeze"` lifted, the others hidden, every node back from its mask after, without a mark). The root becomes a
 * render group once and stays one.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param root - The stage root of `sync`.
 * @param range - The range record, due.
 */
function renderRange(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  root: NonNullable<KeptCtx["ctx"]["state"]["sync"]["root"]>,
  range: RangeRecord
): void {
  const { state, host } = kctx;
  const picture = pictureOf(kctx, pixi, range);

  if (picture === undefined) return;

  const transform = root.getGlobalTransform(matrices.m1, false);
  const group = root.isRenderGroup;
  const rendered = kctx.sync.liftFor(kctx.hidden, range.entries, range.others, "freeze", () =>
    host.renderTo(root, picture, transform, true)
  );

  if (!rendered) return;

  if (!group) state.madeGroups.add(root);

  range.due = false;
  state.takesOpen += 1;
  state.frameTakes += 1;
  state.flushPasses += 1;
}

/**
 * Renders every range owed a picture, after the cached views (so an entry shows their current quads), and checks
 * every sprite's place (P7.5, P7.6): one render of the stage root at the transform the stage pass gives it, inside
 * `liftFor` (the entries hidden only by `"freeze"` lifted, the others and the sprite hidden, every node back from its
 * mask after, without a mark). The root becomes a render group once and stays one.
 *
 * @param kctx - The kept context.
 */
export function flushRanges(kctx: KeptCtx): void {
  const { state, host } = kctx;
  const pixi = host.pixi();
  const matrices = matricesOf(kctx);
  const root = kctx.ctx.state.sync.root;

  if (state.ranges.size === 0 || !canKeep(pixi) || matrices === undefined || root === undefined) {
    return;
  }

  for (const range of state.ranges.values()) {
    if (range.due) renderRange(kctx, pixi, matrices, root, range);

    placeSprite(matrices, range);
    range.lastDrawn = state.frame;
    state.drawnPictures += range.sprite === undefined ? 0 : 1;
  }
}
