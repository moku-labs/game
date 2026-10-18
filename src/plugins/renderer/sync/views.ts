/**
 * @file renderer/sync — one view per entity: build it from the components, write every value,
 * hang it in its layer or under its parent, and give it back to the pool when it leaves.
 */
import { Layer } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import {
  Display,
  NineSlice,
  Shape,
  type ShapeValue,
  Sprite,
  type SpriteValue,
  Transform
} from "../components";
import type {
  PixiContainer,
  PixiGraphics,
  PixiModule,
  PixiNineSliceSprite,
  PixiSprite,
  PixiTexture,
  Point
} from "../types";
import { adaptersOn, clearAdapters, createAdapterObject, writeAdapterAlpha } from "./adapters";
import {
  applyArea,
  applyFilters,
  clearArea,
  clearFilters,
  filtersOf,
  moveArea,
  moveFilters
} from "./filters";
import { clearFonts } from "./fonts";
import { clearHidden, setHidden, writeRenderable } from "./hidden";
import { labelOf } from "./labels";
import { clearLayers, layerContainer, resort } from "./layers";
import { bordersOf, drawOutline, type OutlineShape } from "./outline";
import { noteLeaving } from "./overlay-range";
import { stopOverlays } from "./overlay-state";
import {
  acquire,
  destroyPools,
  detach,
  dropMask,
  dropOutline,
  isGraphics,
  isNineSlice,
  isSprite,
  poolKeyOf,
  release
} from "./pools";
import { isLeaving, parentOf } from "./pose";
import { drawShapePath, strokeShape } from "./shape-path";
import { anchoredBoxInto, boxInto, createSpriteLayout, layoutSpriteInto } from "./sizing";
import {
  clearFrames,
  coverTexture,
  PLACEHOLDER_SIZE,
  PLACEHOLDER_TINT,
  placeholderTexture,
  releaseCover,
  resolveTexture,
  trackKey,
  untrackKey,
  warnMissing
} from "./textures";
import type {
  ClipDrawn,
  DisplayEntry,
  DrawnShape,
  HitBox,
  SyncCtx,
  SyncState,
  View,
  ViewKind
} from "./types";
import { stopWarm } from "./warm";

/**
 * Which component gives an entity its display object, and what it draws.
 */
type Visual = {
  kind: ViewKind;
  textureKey: string;
  /** The registration behind an adapter view; `undefined` for a built-in one. */
  display: DisplayEntry | undefined;
};

/**
 * A display object and, for an adapter view, the component value it was built from.
 */
type BuiltObject = { object: PixiContainer; value: Readonly<object> | undefined };

/** A point of Pixi that `sync` writes: a position, a scale, a pivot, an anchor. */
type WritablePoint = { x: number; y: number; set(x: number, y?: number): void };

/** The tint that leaves a colour as it is: a painted shape's, and the white a tinted shape's path is drawn in. */
const WHITE = 0xff_ff_ff;

/** What `applyAlpha` reads of a visual's component: its alpha. */
type Faded = { alpha: number };

/** The alpha of a visual whose component is gone: drawn whole. */
const OPAQUE: Readonly<Faded> = Object.freeze({ alpha: 1 });

/** The box of the placeholder square on an axis without a size. */
const PLACEHOLDER_BOX = Object.freeze({ width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE });

/**
 * The layout every sprite write fills and reads at once: per frame, reused, no allocation (one write at a time, in the
 * sync pass).
 */
const LAYOUT = createSpriteLayout();

/**
 * The depth of a wrapper's own visual among the wrapper's children: a child at `Order` 0 or more draws above it, one
 * at −1 or less below it, and a ui child at `zIndex` 0 (an `Order` between −0.5 and 0) above it too (spec 16 U1.8).
 */
const VISUAL_DEPTH = -0.5;

/**
 * Marks an entity before a write that changes what Pixi holds for its view: the demand module judges the view as it
 * was drawn. A second mark of the frame costs a lookup.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity whose view is about to change.
 */
function markView(sctx: SyncCtx, entity: Entity): void {
  sctx.deps.demand.mark(entity);
}

/**
 * Marks an entity before a write of its own top's transform: the frame is decided as for any mark, and a kept picture
 * of the view only moves (spec 23 P9.4).
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity whose top is about to move.
 */
function markMoved(sctx: SyncCtx, entity: Entity): void {
  sctx.deps.demand.markMoved(entity);
}

/**
 * Writes a point only when it differs from what Pixi holds, and marks the entity before: a move of the view's own top,
 * or a change of what it draws for a node inside it.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the view.
 * @param point - The point of the display object.
 * @param x - The new x.
 * @param y - The new y.
 * @param mark - The mark to make: `markMoved` for the top, `markView` inside it.
 */
function writePoint(
  sctx: SyncCtx,
  entity: Entity,
  point: WritablePoint,
  x: number,
  y: number,
  mark: (sctx: SyncCtx, entity: Entity) => void = markView
): void {
  if (point.x === x && point.y === y) return;

  mark(sctx, entity);
  point.set(x, y);
}

/**
 * Tells whether a value is a Pixi display object, so a `Display` component can be trusted.
 *
 * @param value - What the game put in the component.
 * @returns True when it can be added to a container.
 */
function isDisplayObject(value: unknown): value is PixiContainer {
  return (
    typeof value === "object" && value !== null && "addChild" in value && "getLocalBounds" in value
  );
}

/**
 * What a visual is called in a message and in a label: the component name.
 *
 * @param visual - The visual of an entity.
 * @returns `"Sprite"`, `"Shape"`, or the name of the component an adapter draws.
 */
function nameOf(visual: Visual): string {
  return visual.display?.component.componentName ?? visual.kind;
}

/**
 * The layer an entity names.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The layer name, or `""` when the entity names none.
 */
function layerNameOf(sctx: SyncCtx, entity: Entity): string {
  return sctx.ctx.deps.world.ecs.get(entity, Layer)?.name ?? "";
}

/**
 * Reports an entity that wants a layer the scene does not declare, naming the projected item it
 * came from so the message points at the game code.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param name - The layer it asked for.
 */
function warnUnknownLayer(sctx: SyncCtx, entity: Entity, name: string): void {
  sctx.ctx.log.warn("renderer: entity is not drawn, unknown layer", {
    entity,
    layer: name,
    from: sctx.ctx.deps.world.projection.keyOf(entity)
  });
}

/**
 * Decides which component gives an entity its display object. An entity has one visual: the
 * order `Sprite`, `NineSlice`, `Display` decides, and the others are reported.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The kind and its texture key, or `undefined` when the entity draws nothing.
 */
export function visualOf(sctx: SyncCtx, entity: Entity): Visual | undefined {
  const ecs = sctx.ctx.deps.world.ecs;
  const found: Visual[] = [];
  const sprite = ecs.get(entity, Sprite);
  const nine = ecs.get(entity, NineSlice);

  if (sprite !== undefined) {
    found.push({ kind: "Sprite", textureKey: sprite.texture, display: undefined });
  }

  if (nine !== undefined) {
    found.push({ kind: "NineSlice", textureKey: nine.texture, display: undefined });
  }

  if (ecs.has(entity, Shape)) found.push({ kind: "Shape", textureKey: "", display: undefined });
  if (ecs.has(entity, Display)) found.push({ kind: "Display", textureKey: "", display: undefined });

  for (const entry of adaptersOn(sctx, entity)) {
    found.push({ kind: "adapter", textureKey: "", display: entry });
  }

  if (found.length > 1) {
    sctx.ctx.log.warn("renderer: entity has more than one visual", {
      entity,
      kinds: found.map(visual => nameOf(visual))
    });
  }

  return found[0];
}

/**
 * Moves a view to another texture key: the pool it goes back to and the invalidate table follow.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param view - Its view.
 * @param key - The new asset key.
 */
function retargetKey(state: SyncState, entity: Entity, view: View, key: string): void {
  if (view.textureKey === key) return;

  untrackKey(state, entity, view.textureKey);
  view.textureKey = key;
  view.poolKey = poolKeyOf(view.kind, key);
  if (key !== "") trackKey(state, entity, key);
}

/**
 * Resolves a key and says whether the placeholder had to step in.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - The asset key.
 * @returns The texture to draw and whether it is the placeholder.
 */
function textureFor(
  sctx: SyncCtx,
  key: string
): { texture: PixiTexture | undefined; missing: boolean } {
  const resolved = resolveTexture(sctx, key);

  if (resolved !== undefined) return { texture: resolved, missing: false };

  warnMissing(sctx, key);

  return { texture: placeholderTexture(sctx), missing: true };
}

/**
 * Writes the texture and the tint of a sprite, each only when it differs from what Pixi holds.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param object - The sprite object.
 * @param texture - The texture to draw, or `undefined` to keep the one it has.
 * @param tint - The tint.
 */
function writeLook(
  sctx: SyncCtx,
  entity: Entity,
  object: PixiSprite,
  texture: PixiTexture | undefined,
  tint: number
): void {
  if (texture !== undefined && object.texture !== texture) {
    markView(sctx, entity);
    object.texture = texture;
  }

  if (object.tint !== tint) {
    markView(sctx, entity);
    object.tint = tint;
  }
}

/**
 * Draws the magenta square of a sprite whose key nothing answers: the 1x1 white texture
 * stretched to the box, 64 x 64 on an axis without a size.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param object - The sprite object.
 * @param view - Its view.
 * @param value - The sprite component.
 * @param texture - The placeholder texture, or `undefined` while inert.
 */
function drawPlaceholder(
  sctx: SyncCtx,
  entity: Entity,
  object: PixiSprite,
  view: View,
  value: Readonly<SpriteValue>,
  texture: PixiTexture | undefined
): void {
  const box = boxInto(LAYOUT.box, PLACEHOLDER_BOX, value);

  writeLook(sctx, entity, object, texture, PLACEHOLDER_TINT);
  writePoint(sctx, entity, object.anchor, value.anchor.x, value.anchor.y);
  view.drawScale.x = box.width;
  view.drawScale.y = box.height;
  anchoredBoxInto(view.hitBox, value.anchor, box);
}

/**
 * Records the crop a view shows now, and lets go of the one it showed before, so a resized or
 * re-keyed cover sprite never leaves a crop behind.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param frameKey - The `frames` key of the crop it shows now; `""` for none.
 */
function showCover(sctx: SyncCtx, entity: Entity, view: View, frameKey: string): void {
  if (view.frameKey === frameKey) return;

  releaseCover(sctx.ctx.state.sync, entity, view.frameKey);
  view.frameKey = frameKey;
}

/**
 * Tells whether the renderer writes the alpha of a view: the three built-in visuals. A `Display`
 * object belongs to the game and an adapter object to the plugin that draws it; their alpha is
 * theirs.
 *
 * @param view - The view.
 * @returns True for a `Sprite`, a `NineSlice` and a `Shape`.
 */
function ownsAlpha(view: View): boolean {
  return view.kind === "Sprite" || view.kind === "NineSlice" || view.kind === "Shape";
}

/**
 * Writes the alpha of a built-in visual. It fades the entity's whole subtree: on a view with a
 * wrapper it goes on the wrapper, over the visual and the children, and the visual inside stays
 * at 1, so the alpha is applied once. A view without a wrapper keeps it on its object. Only a
 * value that differs from what Pixi holds is written, and the entity is marked before. A view
 * drawn at alpha 0, its HUD factor counted, is not drawn at all (spec 26 B9): it leaves Pixi's
 * build, its bounds and the passes of its filters, with its subtree.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - The view of a `Sprite`, a `NineSlice` or a `Shape`.
 * @param look - The component whose `alpha` it draws; the view's HUD factor multiplies it. The component, not the
 *   number: a double handed to a call is boxed, and an alpha tween writes every frame.
 */
function applyAlpha(sctx: SyncCtx, entity: Entity, view: View, look: Readonly<Faded>): void {
  const target = view.wrapper ?? view.object;
  // A HUD part an overlay fades draws its own alpha times the factor (spec 22 O7.4); every other view at 1.
  const drawn = look.alpha * view.hud;

  if (target.alpha !== drawn) {
    markView(sctx, entity);
    target.alpha = drawn;
  }

  if (view.wrapper !== undefined && view.object.alpha !== 1) {
    markView(sctx, entity);
    view.object.alpha = 1;
  }

  setHidden(sctx, entity, view, "alpha", drawn <= 0);
}

/**
 * The component of a built-in visual whose alpha it draws, before the HUD factor.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - The view of a `Sprite`, a `NineSlice` or a `Shape`.
 * @returns The component, or an alpha of 1 when it has none.
 */
function componentAlpha(sctx: SyncCtx, entity: Entity, view: View): Readonly<Faded> {
  const ecs = sctx.ctx.deps.world.ecs;

  if (view.kind === "Sprite") return ecs.get(entity, Sprite) ?? OPAQUE;
  if (view.kind === "NineSlice") return ecs.get(entity, NineSlice) ?? OPAQUE;

  return ecs.get(entity, Shape) ?? OPAQUE;
}

/**
 * Fades a HUD part by the factor the overlays give it (spec 22 O7.4), marked before. A built-in visual multiplies its
 * own alpha by it, on its top; any other view (a text, a game's object) gets a wrapper whose alpha is the factor, so
 * its adapter keeps writing its own object's alpha. An equal factor writes nothing.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the part.
 * @param view - Its view.
 * @param factor - The factor, 0 to 1.
 */
export function applyHud(sctx: SyncCtx, entity: Entity, view: View, factor: number): void {
  if (view.hud === factor) return;

  markView(sctx, entity);
  view.hud = factor;

  if (ownsAlpha(view)) {
    applyAlpha(sctx, entity, view, componentAlpha(sctx, entity, view));

    return;
  }

  const wrapper = ensureWrapper(sctx, entity);

  if (wrapper !== undefined && wrapper.alpha !== factor) wrapper.alpha = factor;
  if (view.kind === "adapter") writeAdapterAlpha(sctx, entity, view);
}

/**
 * Writes the `Sprite` component onto its display object: the texture, or its crop for a `"cover"`
 * sprite, the stretch into the box, and the box as the hit box, the anchor applied. The stretch and
 * the hit box are written into the view's own objects. A new stretch of a view without a wrapper
 * changes the object's own units, so its filter area is written again (B4); a write that keeps it (an
 * alpha tween, a tint) writes no area.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @returns True when the stretch changed: the transform, which folds it into the scale, is owed a write.
 */
export function applySprite(sctx: SyncCtx, entity: Entity, view: View): boolean {
  const stretch = view.drawScale;
  // Compared by its numbers: the view keeps one stretch object, written in place.
  const x = stretch.x;
  const y = stretch.y;

  writeSprite(sctx, entity, view);

  const stretched = stretch.x !== x || stretch.y !== y;

  if (stretched && view.wrapper === undefined && sctx.ctx.state.sync.areas.has(entity)) {
    applyArea(sctx, entity, view);
  }

  return stretched;
}

/**
 * The body of `applySprite`: the texture or its crop, the stretch, the anchor and the hit box.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
function writeSprite(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Sprite);
  const object = view.object;

  if (value === undefined || !isSprite(object)) return;

  retargetKey(sctx.ctx.state.sync, entity, view, value.texture);

  // per frame: the texture resolved without a result object (an alpha tween writes this every frame).
  const texture = resolveTexture(sctx, value.texture);

  if (texture === undefined) warnMissing(sctx, value.texture);

  view.placeholder = texture === undefined;
  applyAlpha(sctx, entity, view, value);

  if (texture === undefined) {
    showCover(sctx, entity, view, "");
    drawPlaceholder(sctx, entity, object, view, value, placeholderTexture(sctx));

    return;
  }

  const layout = layoutSpriteInto(LAYOUT, texture, value);

  if (layout.cover) {
    const cover = coverTexture(sctx, entity, value.texture, texture, layout.box, layout.crop);

    writeLook(sctx, entity, object, cover.texture, value.tint);
    showCover(sctx, entity, view, cover.frameKey);
  } else {
    writeLook(sctx, entity, object, texture, value.tint);
    showCover(sctx, entity, view, "");
  }

  writePoint(sctx, entity, object.anchor, layout.anchor.x, layout.anchor.y);
  view.drawScale.x = layout.drawScale.x;
  view.drawScale.y = layout.drawScale.y;
  anchoredBoxInto(view.hitBox, value.anchor, layout.box);
}

/**
 * Keeps the debug outline of a nine-slice in step: drawn into its wrapper while the component or
 * the global switch asks for it, gone otherwise. An outline that stands is drawn again only when
 * the panel changed.
 *
 * @param sctx - Domain context of the sync module.
 * @param view - The view of the nine-slice.
 * @param shape - What the outline is drawn from.
 * @param debug - The component's own `debug`.
 * @param changed - True when a field of the panel differed in this write.
 */
function applyOutline(
  sctx: SyncCtx,
  view: View,
  shape: OutlineShape,
  debug: boolean,
  changed: boolean
): void {
  const pixi = sctx.deps.host.pixi();

  if (!(debug || sctx.ctx.state.sync.debug.nineSlice) || pixi === undefined) {
    if (view.outline !== undefined) markView(sctx, shape.entity);
    dropOutline(view);

    return;
  }

  if (view.outline !== undefined && !changed) return;

  const wrapper = ensureWrapper(sctx, shape.entity);

  if (wrapper === undefined) return;

  markView(sctx, shape.entity);
  drawOutline(pixi, wrapper, view, shape);
  sctx.ctx.state.sync.redraws += 1;
}

/**
 * Writes one number of a nine-slice only when it differs from what Pixi holds: Pixi rebuilds the
 * panel on every write of a width, even an equal one.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param object - The nine-slice sprite.
 * @param field - Which number.
 * @param value - The new number.
 * @returns True when it was written.
 */
function writeSlice(
  sctx: SyncCtx,
  entity: Entity,
  object: PixiNineSliceSprite,
  field: "leftWidth" | "topHeight" | "rightWidth" | "bottomHeight" | "width" | "height" | "tint",
  value: number
): boolean {
  if (object[field] === value) return false;

  markView(sctx, entity);
  object[field] = value;

  return true;
}

/**
 * Writes the `NineSlice` component onto its display object and recomputes the hit box. Pixi reads
 * a texture's borders only in the constructor, so they are copied here on every write: a pooled
 * object, a new key and a reloaded bundle all get the insets of the texture they draw now.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyNineSlice(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, NineSlice);
  const object = view.object;

  if (value === undefined || !isNineSlice(object)) return;

  retargetKey(sctx.ctx.state.sync, entity, view, value.texture);

  // Resolve the texture and its borders.
  const { texture, missing } = textureFor(sctx, value.texture);
  const borders = bordersOf(texture);

  // Write the texture, the insets, the tint, the alpha and the size: each only when it differs.
  view.placeholder = missing;

  let changed = false;

  if (texture !== undefined && object.texture !== texture) {
    markView(sctx, entity);
    object.texture = texture;
    changed = true;
  }

  changed = writeSlice(sctx, entity, object, "leftWidth", borders.left) || changed;
  changed = writeSlice(sctx, entity, object, "topHeight", borders.top) || changed;
  changed = writeSlice(sctx, entity, object, "rightWidth", borders.right) || changed;
  changed = writeSlice(sctx, entity, object, "bottomHeight", borders.bottom) || changed;
  changed =
    writeSlice(sctx, entity, object, "tint", missing ? PLACEHOLDER_TINT : value.tint) || changed;
  applyAlpha(sctx, entity, view, value);
  changed = writeSlice(sctx, entity, object, "width", value.width) || changed;
  changed = writeSlice(sctx, entity, object, "height", value.height) || changed;

  // Record the hit box, then keep the outline and the clip in step.
  view.hitBox = { x: 0, y: 0, width: value.width, height: value.height };
  applyOutline(
    sctx,
    view,
    { entity, width: value.width, height: value.height, borders, missing },
    value.debug,
    changed
  );
  applyClip(sctx, entity, view, {
    ...Shape.defaults,
    w: value.width,
    h: value.height,
    clip: value.clip
  });
}

/**
 * Gives a clipping view the masked container its children hang in, next to its own visual in the
 * wrapper. The children already in the wrapper move into it with their depth; the visual and the
 * debug outline stay outside, so the mask never cuts them.
 *
 * @param pixi - The Pixi module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param wrapper - Its wrapper.
 * @returns The masked container.
 */
function ensureClipped(
  pixi: PixiModule,
  entity: Entity,
  view: View,
  wrapper: PixiContainer
): PixiContainer {
  if (view.clipped !== undefined) return view.clipped;

  const clipped = new pixi.Container();

  clipped.label = `children#${entity}`;
  clipped.sortableChildren = true;

  for (const child of wrapper.children) {
    if (child !== view.object && child !== view.outline) clipped.addChild(child);
  }

  wrapper.addChild(clipped);
  view.clipped = clipped;

  return clipped;
}

/**
 * Keeps the clip rectangle of a view in step with its value: a clipping view masks the container
 * its children hang in, never its own visual, and a view that stopped clipping loses both mask
 * and container. A nine-slice clips through the plain rectangle of its box, handed in as a shape
 * value.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param value - The shape the mask is drawn from, and whether it clips.
 */
function applyClip(sctx: SyncCtx, entity: Entity, view: View, value: Readonly<ShapeValue>): void {
  const pixi = sctx.deps.host.pixi();

  if (!value.clip || pixi === undefined) {
    if (view.mask !== undefined || view.clipped !== undefined) markView(sctx, entity);
    dropMask(view);
    view.clipDrawn = undefined;

    return;
  }

  const wrapper = ensureWrapper(sctx, entity);

  if (wrapper === undefined) return;

  // Creating the masked container and the mask is structural.
  if (view.clipped === undefined || view.mask === undefined) markView(sctx, entity);

  const clipped = ensureClipped(pixi, entity, view, wrapper);
  const mask = view.mask ?? new pixi.Graphics();

  if (view.mask === undefined) mask.label = `clip#${entity}`;

  // The path of the mask is drawn again only when its rectangle changed.
  if (view.mask === undefined || !sameClip(view.clipDrawn, value)) {
    markView(sctx, entity);
    drawShapePath(mask, value, 1);
    sctx.ctx.state.sync.redraws += 1;
    view.clipDrawn = copyClip(view.clipDrawn, value);
  }

  // The mask sits beside the masked container, in the same local space of the wrapper.
  if (mask.parent !== wrapper) {
    markView(sctx, entity);
    wrapper.addChild(mask);
  }

  if (clipped.mask !== mask) {
    markView(sctx, entity);
    clipped.mask = mask;
  }

  view.mask = mask;
}

/**
 * Tells whether the mask of a view was drawn with this rectangle already.
 *
 * @param drawn - What the mask was last drawn with.
 * @param value - The shape the mask is drawn from now.
 * @returns True when nothing has to be drawn.
 */
function sameClip(drawn: ClipDrawn | undefined, value: Readonly<ShapeValue>): boolean {
  return (
    drawn !== undefined &&
    drawn.kind === value.kind &&
    drawn.w === value.w &&
    drawn.h === value.h &&
    drawn.radius === value.radius
  );
}

/**
 * Keeps what a mask was drawn with, in the object it had, or in a new one the first time.
 *
 * @param drawn - The copy so far.
 * @param value - The shape the mask was drawn from.
 * @returns The copy.
 */
function copyClip(drawn: ClipDrawn | undefined, value: Readonly<ShapeValue>): ClipDrawn {
  if (drawn === undefined)
    return { kind: value.kind, w: value.w, h: value.h, radius: value.radius };

  drawn.kind = value.kind;
  drawn.w = value.w;
  drawn.h = value.h;
  drawn.radius = value.radius;

  return drawn;
}

/**
 * Tells whether a shape's graphics was drawn with this value already: the path, the fill and the
 * stroke. Its alpha, its clip and the fill of a tinted shape (its tint) are written apart.
 *
 * @param drawn - What the graphics was last drawn with.
 * @param value - The shape value now.
 * @param tinted - True when the shape is drawn white and coloured by its tint.
 * @returns True when nothing has to be drawn.
 */
function sameShape(
  drawn: DrawnShape | undefined,
  value: Readonly<ShapeValue>,
  tinted: boolean
): boolean {
  return (
    drawn !== undefined &&
    drawn.tinted === tinted &&
    (tinted || drawn.fill === value.fill) &&
    drawn.kind === value.kind &&
    drawn.w === value.w &&
    drawn.h === value.h &&
    drawn.fillAlpha === value.fillAlpha &&
    drawn.radius === value.radius &&
    drawn.stroke === value.stroke &&
    drawn.strokeWidth === value.strokeWidth &&
    drawn.dash === value.dash
  );
}

/**
 * Keeps what a shape's graphics was drawn with, in the object it had, or in a new one the first
 * time.
 *
 * @param drawn - The copy so far.
 * @param value - The shape value it was drawn from.
 * @param tinted - True when it was drawn white, coloured by its tint.
 * @returns The copy.
 */
function copyShape(
  drawn: DrawnShape | undefined,
  value: Readonly<ShapeValue>,
  tinted: boolean
): DrawnShape {
  if (drawn === undefined) {
    const { kind, w, h, fill, fillAlpha, radius, stroke, strokeWidth, dash } = value;

    return { tinted, kind, w, h, fill, fillAlpha, radius, stroke, strokeWidth, dash };
  }

  const copy = drawn;

  copy.tinted = tinted;
  copy.kind = value.kind;
  copy.w = value.w;
  copy.h = value.h;
  copy.fill = value.fill;
  copy.fillAlpha = value.fillAlpha;
  copy.radius = value.radius;
  copy.stroke = value.stroke;
  copy.strokeWidth = value.strokeWidth;
  copy.dash = value.dash;

  return copy;
}

/**
 * Tells whether a shape draws nothing: no stroke, and no fill alpha or no area. Pure.
 *
 * @param value - The shape value.
 * @returns True for a shape whose `Graphics` would hold no instruction.
 * @example
 * ```ts
 * isEmptyShape({ ...Shape.defaults, w: 1080, h: 200, fillAlpha: 0 }); // true
 * ```
 */
function isEmptyShape(value: Readonly<ShapeValue>): boolean {
  return value.strokeWidth <= 0 && (value.fillAlpha <= 0 || value.w <= 0 || value.h <= 0);
}

/**
 * Draws the path of a shape that is not empty, only when it differs from the one drawn last, and writes its tint. A
 * fill-only shape is drawn white and coloured by its tint (spec 26 R2.1): a colour change rewrites the tint, never the
 * path, so Pixi rebuilds no instruction list. A shape with a stroke is painted in its own colours under a white tint.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param object - Its graphics.
 * @param value - The shape value.
 */
function drawShape(
  sctx: SyncCtx,
  entity: Entity,
  view: View,
  object: PixiGraphics,
  value: Readonly<ShapeValue>
): void {
  const tinted = value.strokeWidth <= 0;

  if (!sameShape(view.drawn, value, tinted)) {
    markView(sctx, entity);
    drawShapePath(object, value, value.fillAlpha, tinted ? WHITE : value.fill);
    strokeShape(object, value);
    sctx.ctx.state.sync.redraws += 1;
    view.drawn = copyShape(view.drawn, value, tinted);
  }

  const tint = tinted ? value.fill : WHITE;

  if (object.tint !== tint) {
    markView(sctx, entity);
    object.tint = tint;
  }
}

/**
 * Writes the box of a shape into the hit box its view owns: a changed shape allocates nothing.
 *
 * @param box - The hit box of the view.
 * @param width - The shape's width.
 * @param height - The shape's height.
 */
function writeHitBox(box: HitBox, width: number, height: number): void {
  box.x = 0;
  box.y = 0;
  box.width = width;
  box.height = height;
}

/**
 * Writes the `Shape` component onto its graphics object and recomputes the hit box. The path is
 * drawn here and nowhere else, and only when it differs from the one drawn last, so a still shape
 * costs nothing per frame and an alpha-only change draws no path. A shape that draws nothing is not
 * drawn at all (spec 26 B7): its visual leaves Pixi's build and its bounds, while its children, its
 * clip mask and its hit box stay.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyShape(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Shape);
  const object = view.object;

  if (value === undefined || !isGraphics(object)) return;

  const empty = isEmptyShape(value);

  setHidden(sctx, entity, view, "empty", empty);
  if (!empty) drawShape(sctx, entity, view, object, value);

  applyAlpha(sctx, entity, view, value);
  writeHitBox(view.hitBox, value.w, value.h);
  applyClip(sctx, entity, view, value);
}

/**
 * Reads the hit box of a `Display` object once, at attach time.
 *
 * @param view - The view.
 */
export function measureDisplay(view: View): void {
  const bounds = view.object.getLocalBounds();

  view.hitBox = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/**
 * Writes whichever visual component the view was built from.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function writeVisual(sctx: SyncCtx, entity: Entity, view: View): void {
  if (view.kind === "Sprite") {
    applySprite(sctx, entity, view);

    return;
  }

  if (view.kind === "NineSlice") {
    applyNineSlice(sctx, entity, view);

    return;
  }

  if (view.kind === "Shape") {
    applyShape(sctx, entity, view);

    return;
  }

  measureDisplay(view);
}

/**
 * Writes the `Transform` component: `position` is where the `pivot` lands. The stretch of the
 * visual (a sized sprite, the 64 x 64 placeholder) is folded into the object's scale, so the
 * pivot is written in the object's own units. A wrapper carries the pose instead, and the visual
 * inside it keeps only its stretch.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyTransform(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Transform) ?? Transform.defaults;
  const target = view.wrapper ?? view.object;
  const stretch: Point = view.drawScale;

  // The top's own pose moves the view: a kept picture follows it (P9.4). Writes inside a wrapper change the picture.
  writePoint(sctx, entity, target.position, value.x, value.y, markMoved);
  writeRotation(sctx, entity, target, value.rotation, markMoved);

  if (view.wrapper === undefined) {
    writePoint(
      sctx,
      entity,
      target.scale,
      value.scale * stretch.x,
      value.scale * stretch.y,
      markMoved
    );
    writePoint(
      sctx,
      entity,
      target.pivot,
      value.pivot.x / stretch.x,
      value.pivot.y / stretch.y,
      markMoved
    );

    return;
  }

  writePoint(sctx, entity, target.scale, value.scale, value.scale, markMoved);
  writePoint(sctx, entity, target.pivot, value.pivot.x, value.pivot.y, markMoved);
  writePoint(sctx, entity, view.object.position, 0, 0);
  writeRotation(sctx, entity, view.object, 0);
  writePoint(sctx, entity, view.object.pivot, 0, 0);
  writePoint(sctx, entity, view.object.scale, stretch.x, stretch.y);
}

/**
 * Writes a rotation only when it differs from what Pixi holds, and marks the entity before.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param target - The display object.
 * @param rotation - The new rotation, in radians.
 * @param mark - The mark to make: `markMoved` for the top, `markView` inside it.
 */
function writeRotation(
  sctx: SyncCtx,
  entity: Entity,
  target: PixiContainer,
  rotation: number,
  mark: (sctx: SyncCtx, entity: Entity) => void = markView
): void {
  if (target.rotation === rotation) return;

  mark(sctx, entity);
  target.rotation = rotation;
}

/**
 * Gives a parent entity the container its children hang in. A v8 sprite takes no children, so
 * the parent's own visual moves into the wrapper as child 0 and the transform moves with it. The
 * wrapper sorts its children by their `Order`; the visual is child 0 at depth −0.5, so a child at
 * `Order` 0, and a ui child at `zIndex` 0, draws above it. A clipping parent hangs its children one level down, in the
 * masked container `applyClip` adds. The filters and the alpha of a built-in visual move up to
 * the wrapper, so they cover the children too.
 *
 * @param sctx - Domain context of the sync module.
 * @param parentEntity - The entity named as a parent.
 * @returns The wrapper, or `undefined` when the parent draws nothing.
 */
export function ensureWrapper(sctx: SyncCtx, parentEntity: Entity): PixiContainer | undefined {
  const view = sctx.ctx.state.sync.views.get(parentEntity);
  const pixi = sctx.deps.host.pixi();

  if (view === undefined || pixi === undefined) return undefined;
  if (view.wrapper !== undefined) return view.wrapper;

  // A new level in the tree: structural, marked before it is built.
  markView(sctx, parentEntity);

  const wrapper = new pixi.Container();
  const container = view.object.parent;

  wrapper.label = `parent#${parentEntity}`;
  wrapper.sortableChildren = true;
  wrapper.zIndex = view.object.zIndex;

  if (container !== null) {
    container.addChildAt(wrapper, Math.max(0, container.children.indexOf(view.object)));
  }

  view.object.zIndex = VISUAL_DEPTH;
  wrapper.addChild(view.object);
  view.wrapper = wrapper;
  // The subtree reasons move from the visual up to the wrapper; the visual keeps only its own.
  sctx.ctx.state.sync.viewOfTop.delete(view.object);
  sctx.ctx.state.sync.viewOfTop.set(wrapper, view);
  writeRenderable(view);
  applyTransform(sctx, parentEntity, view);
  // The filters and the alpha cover the subtree: they move from the visual up to the wrapper.
  moveFilters(
    sctx.ctx.state.sync,
    parentEntity,
    view,
    () => markView(sctx, parentEntity),
    sctx.ctx.state.kept
  );
  // The filter area hangs where the filters do (B4).
  if (sctx.ctx.state.sync.areas.has(parentEntity)) moveArea(sctx, parentEntity, view);
  if (ownsAlpha(view))
    applyAlpha(sctx, parentEntity, view, componentAlpha(sctx, parentEntity, view));

  return wrapper;
}

/**
 * Gives a view whose picture the kept cache is about to take its wrapper, so the picture's first render has a plain
 * `Container` for its root (spec 23 D4): a sprite, a nine-slice or a shape made the root of a render group draws other
 * pixels than it does live. Pixi's sprite pipe keeps the group transform it cached before, so the sprite lands outside
 * its picture, and the root's own tint and alpha are applied twice. Inside the wrapper the visual keeps its stretch and
 * its tint; the pose, the filters, the filter area and a built-in visual's alpha move up, as for a parent. The wrapper
 * carries the view's label, so the pictures and their passes still name the view, and it stays with the view until
 * the view leaves. Called with the quiet context of the cache: the wrapper draws the same pixels, so it marks nothing.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the view.
 * @returns The wrapper, or `undefined` when the entity has no view or Pixi is not loaded.
 */
export function wrapForPicture(sctx: SyncCtx, entity: Entity): PixiContainer | undefined {
  const view = sctx.ctx.state.sync.views.get(entity);

  if (view === undefined) return undefined;
  if (view.wrapper !== undefined) return view.wrapper;

  const label = view.object.label;
  const wrapper = ensureWrapper(sctx, entity);

  if (wrapper !== undefined) wrapper.label = label;

  return wrapper;
}

/**
 * The container the children of a parent hang in: the masked one while the parent clips, its
 * wrapper otherwise.
 *
 * @param sctx - Domain context of the sync module.
 * @param parentEntity - The entity named as a parent.
 * @returns The container, or `undefined` when the parent draws nothing.
 */
function childHostOf(sctx: SyncCtx, parentEntity: Entity): PixiContainer | undefined {
  const wrapper = ensureWrapper(sctx, parentEntity);

  return sctx.ctx.state.sync.views.get(parentEntity)?.clipped ?? wrapper;
}

/**
 * Detaches a view whose parent has no view yet and keeps it as an orphan, drawn nowhere until the pass that builds
 * the parent's view hangs it (spec 16 U2.4). A parent that carries no visual at all is reported, once per orphan.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param parentEntity - The entity its `Parent` names.
 */
function keepOrphan(sctx: SyncCtx, entity: Entity, view: View, parentEntity: Entity): void {
  const orphans = sctx.ctx.state.sync.orphans;
  const known = orphans.has(entity);

  orphans.add(entity);
  detach(view.wrapper ?? view.object);

  if (!known && visualOf(sctx, parentEntity) === undefined) {
    sctx.ctx.log.warn("renderer: parent draws nothing", { entity, parent: parentEntity });
  }
}

/**
 * Hangs a view where it belongs: under its parent, or in the container of the layer it names.
 * An entity with no layer and no parent is not drawn. A view whose parent has no view yet waits
 * as an orphan, detached, so it is never drawn in a layer while its parent waits.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function attach(sctx: SyncCtx, entity: Entity, view: View): void {
  const state = sctx.ctx.state.sync;
  const parentEntity = parentOf(sctx.ctx.deps.world.ecs, entity);

  // Structural: `addChild` re-adds the view and moves it among equal depths, so it always marks.
  markView(sctx, entity);
  // A view that leaves an overlay's range changes its picture: judged where it was.
  noteLeaving(state, view);

  if (parentEntity !== 0) {
    const host = childHostOf(sctx, parentEntity);

    view.layer = "";

    if (host === undefined) {
      keepOrphan(sctx, entity, view, parentEntity);

      return;
    }

    state.orphans.delete(entity);
    host.addChild(view.wrapper ?? view.object);

    return;
  }

  state.orphans.delete(entity);

  const name = layerNameOf(sctx, entity);
  const container = layerContainer(state, name);

  view.layer = name;

  if (container === undefined) {
    warnUnknownLayer(sctx, entity, name);
    detach(view.object);

    return;
  }

  container.addChild(view.wrapper ?? view.object);
}

/**
 * Builds the display object of a view: the game's own object for a `Display`, otherwise one out
 * of the pool or a fresh one.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param visual - Which component gives the entity its object, and its texture key.
 * @param visual.kind - Which component gives the entity its object.
 * @param visual.textureKey - The asset key the object draws.
 * @returns The object, or `undefined` while inert.
 */
function makeObject(sctx: SyncCtx, entity: Entity, visual: Visual): BuiltObject | undefined {
  if (visual.kind === "Display") {
    const object = displayObjectOf(sctx, entity);

    return object === undefined ? undefined : { object, value: undefined };
  }

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return undefined;
  if (visual.display !== undefined) return adapterObject(sctx, entity, visual.display);

  const pooled = acquire(sctx.ctx.state.sync, poolKeyOf(visual.kind, visual.textureKey));

  if (pooled !== undefined) return { object: pooled, value: undefined };
  if (visual.kind === "Sprite")
    return { object: new pixi.Sprite(pixi.Texture.WHITE), value: undefined };
  if (visual.kind === "Shape") return { object: new pixi.Graphics(), value: undefined };

  return { object: new pixi.NineSliceSprite({ texture: pixi.Texture.WHITE }), value: undefined };
}

/**
 * Asks an adapter for the display object of an entity, and checks what came back: a plugin above
 * must hand over something the renderer can hang in the tree.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param entry - The registration that draws its component.
 * @returns The object with the value it was built from, or `undefined` when it cannot be drawn.
 */
function adapterObject(
  sctx: SyncCtx,
  entity: Entity,
  entry: DisplayEntry
): BuiltObject | undefined {
  const built = createAdapterObject(sctx, entity, entry);

  if (built !== undefined && isDisplayObject(built.object)) {
    return { object: built.object, value: built.value };
  }

  sctx.ctx.log.warn("renderer: adapter built no display object", {
    entity,
    component: entry.component.componentName
  });

  return undefined;
}

/**
 * Builds the view of one entity and hangs it in the tree, with the filters kept for it.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns True when a view was built now; false when one exists or nothing is drawable.
 */
export function createView(sctx: SyncCtx, entity: Entity): boolean {
  const state = sctx.ctx.state.sync;

  if (state.views.has(entity)) return false;

  // Structural, before anything is built: with no view yet the mark waits for the decision.
  markView(sctx, entity);

  const visual = visualOf(sctx, entity);

  if (visual === undefined) return false;

  const built = makeObject(sctx, entity, visual);

  if (built === undefined) return false;

  const object = built.object;
  const view: View = {
    object,
    kind: visual.kind,
    poolKey: poolKeyOf(visual.kind, visual.textureKey),
    layer: "",
    textureKey: visual.textureKey,
    wrapper: undefined,
    placeholder: false,
    mask: undefined,
    clipped: undefined,
    display: visual.display,
    value: built.value,
    drawScale: { x: 1, y: 1 },
    frameKey: "",
    outline: undefined,
    hitBox: { x: 0, y: 0, width: 0, height: 0 },
    drawn: undefined,
    clipDrawn: undefined,
    hiddenSelf: 0,
    hiddenTop: 0,
    hud: 1
  };

  object.label = labelOf(sctx, nameOf(visual), entity);
  state.views.set(entity, view);
  state.entityOf.set(object, entity);
  state.viewOfTop.set(object, view);
  if (visual.textureKey !== "") trackKey(state, entity, visual.textureKey);

  writeVisual(sctx, entity, view);
  // An adapter's object built at alpha 0 is not drawn (B9); the built-in visuals do it in `applyAlpha`.
  if (view.kind === "adapter") writeAdapterAlpha(sctx, entity, view);
  applyTransform(sctx, entity, view);
  attach(sctx, entity, view);
  const slots = filtersOf(state, entity);

  applyFilters(view, slots, () => markView(sctx, entity));
  // The filter area kept for it lands with the filters (B4).
  if (state.areas.has(entity)) applyArea(sctx, entity, view);
  // A view built with filters kept for it gets its record of the kept cache (spec 23 P9.1).
  if (slots.length > 0) sctx.deps.kept.slots(entity, slots);
  resort(sctx, entity, view);

  return true;
}

/**
 * The Pixi object a `Display` component carries.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The object, or `undefined` when the component holds something else.
 */
function displayObjectOf(sctx: SyncCtx, entity: Entity): PixiContainer | undefined {
  const value = sctx.ctx.deps.world.ecs.get(entity, Display)?.object;

  if (isDisplayObject(value)) return value;

  sctx.ctx.log.warn("renderer: Display holds no display object", { entity });

  return undefined;
}

/**
 * Detaches the children of a parent that left, and names the ones that stay. A child that leaves in the same teardown
 * is no orphan: its view goes in this very pass (it waits in `removed`), or it plays its exit (`Exiting`).
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The parent entity.
 * @param host - The container its children hang in.
 */
function detachChildren(sctx: SyncCtx, entity: Entity, host: PixiContainer): void {
  const state = sctx.ctx.state.sync;
  const ecs = sctx.ctx.deps.world.ecs;
  const orphans: Entity[] = [];

  for (const [child, childView] of state.views) {
    if (child === entity) continue;

    const object = childView.wrapper ?? childView.object;

    if (object.parent !== host) continue;

    markView(sctx, child);
    detach(object);
    // A child that stays waits for the parent's next view (a new `Display`, a visual that comes back).
    state.orphans.add(child);
    if (!state.removed.has(child) && !isLeaving(ecs, child)) orphans.push(child);
  }

  if (orphans.length > 0) {
    sctx.ctx.log.warn("renderer: parent left before its children", { parent: entity, orphans });
  }
}

/**
 * Takes a view out of the tree and gives its object back to the pool.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity that left.
 */
export function dropView(sctx: SyncCtx, entity: Entity): void {
  const state = sctx.ctx.state.sync;
  const view = state.views.get(entity);

  if (view === undefined) return;

  // Structural: the view leaves the tree, judged where it was drawn.
  markView(sctx, entity);
  noteLeaving(state, view);
  // Its picture goes before the object returns to the pool (P9.3): no quad, no reason, no render group left.
  sctx.deps.kept.forget(entity);

  const host = view.clipped ?? view.wrapper;

  if (host !== undefined) detachChildren(sctx, entity, host);

  state.views.delete(entity);
  // Its filters and area stay while the entity lives: the pass looks for its despawn.
  if (state.filters.has(entity) || state.areas.has(entity)) state.viewlessEntries = true;
  state.orphans.delete(entity);
  state.entityOf.delete(view.object);
  state.viewOfTop.delete(view.wrapper ?? view.object);
  untrackKey(state, entity, view.textureKey);

  if (view.frameKey !== "") {
    const white = placeholderTexture(sctx);

    // The pooled sprite must not keep a crop that the last user may be about to free.
    if (white !== undefined && isSprite(view.object)) view.object.texture = white;
    showCover(sctx, entity, view, "");
  }

  release(sctx, view);
}

/**
 * Drops every view, every layer, every pool, every filter slot and filter area, and the warm-up (its waiting promises
 * answer false, its probe tree is destroyed). Works on the state alone,
 * because `onStop` has no context. A `Display` object belongs to the game: it is detached, never
 * destroyed, and leaves without the filters, the filter area and the hidden reasons the renderer gave it.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopSync(state: SyncState): void {
  // The world hooks and the system go first: nothing collects into the sets below any more.
  for (const off of state.cleanups) off();
  state.cleanups.length = 0;

  // Every view: the game's objects and the adapters' leave the tree; the engine's own go with the root below.
  for (const view of state.views.values()) {
    clearHidden(view);
    state.viewOfTop.delete(view.wrapper ?? view.object);

    if (view.kind === "Display") {
      detach(view.object);
      clearFilters(view.object);
      clearArea(view.object);
    }

    if (view.kind === "adapter") {
      detach(view.object);
      view.display?.adapter.destroy(view.object);
    }

    view.mask = undefined;
    view.clipped = undefined;
    // A live view is left detached with its layer, so its outline is freed here.
    dropOutline(view);
    view.wrapper = undefined;
  }

  // The modules of sync that hold their own: overlays, adapters, fonts, crops.
  stopOverlays(state);
  clearAdapters(state);
  clearFonts(state);
  clearFrames(state);

  // The maps and the change sets, empty for the next start.
  state.views.clear();
  state.entityOf.clear();
  state.byKey.clear();
  state.invalidated.clear();
  state.warned.clear();
  state.added.clear();
  state.removed.clear();
  state.reparented.clear();
  state.orphans.clear();
  state.mismatched.clear();
  state.providers.length = 0;
  state.filters.clear();
  state.areas.clear();
  state.viewlessEntries = false;
  stopWarm(state);
  state.held.clear();
  state.redraws = 0;
  state.overdraw.listeners.length = 0;

  // The tree last: the layers, the pooled objects and the root with what still hangs in it.
  clearLayers(state);
  destroyPools(state);
  state.root?.destroy({ children: true });
  state.root = undefined;
}
