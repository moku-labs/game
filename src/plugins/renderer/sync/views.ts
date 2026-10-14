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
import { adaptersOn, clearAdapters, createAdapterObject } from "./adapters";
import { applyFilters, clearFilters, filtersOf, moveFilters } from "./filters";
import { clearFonts } from "./fonts";
import { labelOf } from "./labels";
import { clearLayers, layerContainer, resort } from "./layers";
import { bordersOf, drawOutline, type OutlineShape } from "./outline";
import {
  acquire,
  destroyPools,
  detach,
  dropMask,
  dropOutline,
  isNineSlice,
  isSprite,
  poolKeyOf,
  release
} from "./pools";
import { parentOf } from "./pose";
import { drawShapePath, strokeShape } from "./shape-path";
import { anchoredBox, boxOf, layoutSprite } from "./sizing";
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
  SyncCtx,
  SyncState,
  View,
  ViewKind
} from "./types";

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
 * Writes a point only when it differs from what Pixi holds, and marks the entity before.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the view.
 * @param point - The point of the display object.
 * @param x - The new x.
 * @param y - The new y.
 */
function writePoint(
  sctx: SyncCtx,
  entity: Entity,
  point: WritablePoint,
  x: number,
  y: number
): void {
  if (point.x === x && point.y === y) return;

  markView(sctx, entity);
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
 * Tells whether a display object draws paths, so a `Shape` can be written onto it.
 *
 * @param object - The display object.
 * @returns True for a graphics object.
 */
function isGraphics(object: PixiContainer): object is PixiGraphics {
  return "roundRect" in object;
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
  const box = boxOf({ width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE }, value);

  writeLook(sctx, entity, object, texture, PLACEHOLDER_TINT);
  writePoint(sctx, entity, object.anchor, value.anchor.x, value.anchor.y);
  view.drawScale = { x: box.width, y: box.height };
  view.hitBox = anchoredBox(value.anchor, box);
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
 * value that differs from what Pixi holds is written, and the entity is marked before.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - The view of a `Sprite`, a `NineSlice` or a `Shape`.
 * @param alpha - The alpha of the component.
 */
function applyAlpha(sctx: SyncCtx, entity: Entity, view: View, alpha: number): void {
  const target = view.wrapper ?? view.object;

  if (target.alpha !== alpha) {
    markView(sctx, entity);
    target.alpha = alpha;
  }

  if (view.wrapper !== undefined && view.object.alpha !== 1) {
    markView(sctx, entity);
    view.object.alpha = 1;
  }
}

/**
 * Writes the `Sprite` component onto its display object: the texture, or its crop for a `"cover"`
 * sprite, the stretch into the box, and the box as the hit box, the anchor applied.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applySprite(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Sprite);
  const object = view.object;

  if (value === undefined || !isSprite(object)) return;

  retargetKey(sctx.ctx.state.sync, entity, view, value.texture);

  const { texture, missing } = textureFor(sctx, value.texture);

  view.placeholder = missing;
  applyAlpha(sctx, entity, view, value.alpha);

  if (missing || texture === undefined) {
    showCover(sctx, entity, view, "");
    drawPlaceholder(sctx, entity, object, view, value, texture);

    return;
  }

  const layout = layoutSprite({ width: texture.width, height: texture.height }, value);
  const cover =
    layout.crop === undefined
      ? { texture, frameKey: "" }
      : coverTexture(sctx, entity, value.texture, texture, layout.box, layout.crop);

  writeLook(sctx, entity, object, cover.texture, value.tint);
  showCover(sctx, entity, view, cover.frameKey);
  writePoint(sctx, entity, object.anchor, layout.anchor.x, layout.anchor.y);
  view.drawScale = layout.drawScale;
  view.hitBox = anchoredBox(value.anchor, layout.box);
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
  applyAlpha(sctx, entity, view, value.alpha);
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
 * stroke. Its alpha and its clip are written apart.
 *
 * @param drawn - What the graphics was last drawn with.
 * @param value - The shape value now.
 * @returns True when nothing has to be drawn.
 */
function sameShape(drawn: DrawnShape | undefined, value: Readonly<ShapeValue>): boolean {
  return (
    drawn !== undefined &&
    drawn.kind === value.kind &&
    drawn.w === value.w &&
    drawn.h === value.h &&
    drawn.fill === value.fill &&
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
 * @returns The copy.
 */
function copyShape(drawn: DrawnShape | undefined, value: Readonly<ShapeValue>): DrawnShape {
  if (drawn === undefined) {
    const { kind, w, h, fill, fillAlpha, radius, stroke, strokeWidth, dash } = value;

    return { kind, w, h, fill, fillAlpha, radius, stroke, strokeWidth, dash };
  }

  const copy = drawn;

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
 * Writes the `Shape` component onto its graphics object and recomputes the hit box. The path is
 * drawn here and nowhere else, and only when it differs from the one drawn last, so a still shape
 * costs nothing per frame and an alpha-only change draws no path.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyShape(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Shape);
  const object = view.object;

  if (value === undefined || !isGraphics(object)) return;

  if (!sameShape(view.drawn, value)) {
    markView(sctx, entity);
    drawShapePath(object, value, value.fillAlpha);
    strokeShape(object, value);
    view.drawn = copyShape(view.drawn, value);
  }

  applyAlpha(sctx, entity, view, value.alpha);
  view.hitBox = { x: 0, y: 0, width: value.w, height: value.h };
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

  writePoint(sctx, entity, target.position, value.x, value.y);
  writeRotation(sctx, entity, target, value.rotation);

  if (view.wrapper === undefined) {
    writePoint(sctx, entity, target.scale, value.scale * stretch.x, value.scale * stretch.y);
    writePoint(sctx, entity, target.pivot, value.pivot.x / stretch.x, value.pivot.y / stretch.y);

    return;
  }

  writePoint(sctx, entity, target.scale, value.scale, value.scale);
  writePoint(sctx, entity, target.pivot, value.pivot.x, value.pivot.y);
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
 */
function writeRotation(
  sctx: SyncCtx,
  entity: Entity,
  target: PixiContainer,
  rotation: number
): void {
  if (target.rotation === rotation) return;

  markView(sctx, entity);
  target.rotation = rotation;
}

/**
 * Gives a parent entity the container its children hang in. A v8 sprite takes no children, so
 * the parent's own visual moves into the wrapper as child 0 and the transform moves with it. The
 * wrapper sorts its children by their `Order`; the visual is child 0 at depth 0, so a child with
 * the same depth draws above it. A clipping parent hangs its children one level down, in the
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

  view.object.zIndex = 0;
  wrapper.addChild(view.object);
  view.wrapper = wrapper;
  applyTransform(sctx, parentEntity, view);
  // The filters and the alpha cover the subtree: they move from the visual up to the wrapper.
  moveFilters(sctx.ctx.state.sync, parentEntity, view, () => markView(sctx, parentEntity));
  if (ownsAlpha(view)) applyAlpha(sctx, parentEntity, view, view.object.alpha);

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
 * Hangs a view where it belongs: under its parent, or in the container of the layer it names.
 * An entity with no layer and no parent is not drawn.
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

  if (parentEntity !== 0) {
    const host = childHostOf(sctx, parentEntity);

    view.layer = "";

    if (host === undefined) {
      sctx.ctx.log.warn("renderer: parent draws nothing", { entity, parent: parentEntity });
      detach(view.object);

      return;
    }

    host.addChild(view.wrapper ?? view.object);

    return;
  }

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
    clipDrawn: undefined
  };

  object.label = labelOf(sctx, nameOf(visual), entity);
  state.views.set(entity, view);
  state.entityOf.set(object, entity);
  if (visual.textureKey !== "") trackKey(state, entity, visual.textureKey);

  writeVisual(sctx, entity, view);
  applyTransform(sctx, entity, view);
  attach(sctx, entity, view);
  applyFilters(view, filtersOf(state, entity), () => markView(sctx, entity));
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
 * Detaches the children of a parent that left, and names them.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The parent entity.
 * @param host - The container its children hang in.
 */
function detachChildren(sctx: SyncCtx, entity: Entity, host: PixiContainer): void {
  const orphans: Entity[] = [];

  for (const [child, childView] of sctx.ctx.state.sync.views) {
    if (child === entity) continue;

    const object = childView.wrapper ?? childView.object;

    if (object.parent !== host) continue;

    markView(sctx, child);
    detach(object);
    orphans.push(child);
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

  const host = view.clipped ?? view.wrapper;

  if (host !== undefined) detachChildren(sctx, entity, host);

  state.views.delete(entity);
  state.entityOf.delete(view.object);
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
 * Drops every view, every layer, every pool and every filter slot. Works on the state alone,
 * because `onStop` has no context. A `Display` object belongs to the game: it is detached, never
 * destroyed, and leaves without the filters the renderer hung on it.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopSync(state: SyncState): void {
  for (const off of state.cleanups) off();
  state.cleanups.length = 0;

  for (const view of state.views.values()) {
    if (view.kind === "Display") {
      detach(view.object);
      clearFilters(view.object);
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

  clearAdapters(state);
  clearFonts(state);
  clearFrames(state);
  state.views.clear();
  state.entityOf.clear();
  state.byKey.clear();
  state.invalidated.clear();
  state.warned.clear();
  state.added.clear();
  state.removed.clear();
  state.reparented.clear();
  state.providers.length = 0;
  state.filters.clear();

  clearLayers(state);
  destroyPools(state);
  state.root?.destroy({ children: true });
  state.root = undefined;
}
