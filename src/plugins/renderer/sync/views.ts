/**
 * @file renderer/sync — one view per entity: build it from the components, write every value,
 * hang it in its layer or under its parent, and give it back to the pool when it leaves.
 */
import { Layer } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import {
  Display,
  NineSlice,
  Parent,
  Shape,
  type ShapeValue,
  Sprite,
  Transform
} from "../components";
import type { PixiContainer, PixiGraphics, PixiTexture } from "../types";
import { adaptersOn, clearAdapters, createAdapterObject } from "./adapters";
import { clearFonts } from "./fonts";
import { labelOf } from "./labels";
import { clearLayers, layerContainer, resort } from "./layers";
import {
  acquire,
  destroyPools,
  detach,
  dropMask,
  isNineSlice,
  isSprite,
  poolKeyOf,
  release
} from "./pools";
import {
  PLACEHOLDER_SIZE,
  PLACEHOLDER_TINT,
  placeholderTexture,
  resolveTexture,
  trackKey,
  untrackKey,
  warnMissing
} from "./textures";
import type { DisplayEntry, SyncCtx, SyncState, View, ViewKind } from "./types";

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
 * Writes the `Sprite` component onto its display object and recomputes the hit box.
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
  if (texture !== undefined) object.texture = texture;
  object.tint = missing ? PLACEHOLDER_TINT : value.tint;
  object.alpha = value.alpha;
  object.anchor.set(value.anchor.x, value.anchor.y);

  const width = missing ? PLACEHOLDER_SIZE : object.texture.width;
  const height = missing ? PLACEHOLDER_SIZE : object.texture.height;

  view.hitBox = { x: -value.anchor.x * width, y: -value.anchor.y * height, width, height };
}

/**
 * Writes the `NineSlice` component onto its display object and recomputes the hit box.
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

  const { texture, missing } = textureFor(sctx, value.texture);

  view.placeholder = missing;
  if (texture !== undefined) object.texture = texture;
  object.tint = missing ? PLACEHOLDER_TINT : 0xff_ff_ff;
  object.width = value.width;
  object.height = value.height;
  view.hitBox = { x: 0, y: 0, width: value.width, height: value.height };
}

/**
 * Draws the rectangle of a shape: one path, filled, with the corners the value asks for.
 *
 * @param object - The graphics to draw on.
 * @param value - The shape value.
 * @param fill - The fill colour.
 */
function drawRect(object: PixiGraphics, value: Readonly<ShapeValue>, fill: number): void {
  object.clear();

  if (value.radius > 0) {
    object.roundRect(0, 0, value.w, value.h, value.radius);
  } else {
    object.rect(0, 0, value.w, value.h);
  }

  object.fill({ color: fill });
}

/**
 * Keeps the clip rectangle of a shape in step with its value: a clipping shape gets a wrapper
 * whose children are masked, and a shape that stopped clipping loses both mask and effect.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param value - The shape value.
 */
function applyClip(sctx: SyncCtx, entity: Entity, view: View, value: Readonly<ShapeValue>): void {
  const pixi = sctx.deps.host.pixi();

  if (!value.clip || pixi === undefined) {
    dropMask(view);

    return;
  }

  const wrapper = ensureWrapper(sctx, entity);

  if (wrapper === undefined) return;

  const mask = view.mask ?? new pixi.Graphics();

  mask.label = `clip#${entity}`;
  drawRect(mask, value, value.fill);

  if (mask.parent !== wrapper) wrapper.addChild(mask);

  wrapper.mask = mask;
  view.mask = mask;
}

/**
 * Writes the `Shape` component onto its graphics object and recomputes the hit box. The path is
 * drawn here and nowhere else, so a still shape costs nothing per frame.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyShape(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Shape);
  const object = view.object;

  if (value === undefined || !isGraphics(object)) return;

  drawRect(object, value, value.fill);

  if (value.strokeWidth > 0) object.stroke({ color: value.stroke, width: value.strokeWidth });

  object.alpha = value.alpha;
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
 * Writes the `Transform` component. A placeholder sprite is drawn 64 times its 1x1 texture, so
 * the magenta square is visible at the right size.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function applyTransform(sctx: SyncCtx, entity: Entity, view: View): void {
  const value = sctx.ctx.deps.world.ecs.get(entity, Transform) ?? Transform.defaults;
  const target = view.wrapper ?? view.object;
  const factor = view.kind === "Sprite" && view.placeholder ? PLACEHOLDER_SIZE : 1;

  target.position.set(value.x, value.y);
  target.rotation = value.rotation;

  if (view.wrapper === undefined) {
    target.scale.set(value.scale * factor);

    return;
  }

  target.scale.set(value.scale);
  view.object.scale.set(factor);
}

/**
 * Gives a parent entity the container its children hang in. A v8 sprite takes no children, so
 * the parent's own visual moves into the wrapper as child 0 and the transform moves with it.
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

  const wrapper = new pixi.Container();
  const container = view.object.parent;

  wrapper.label = `parent#${parentEntity}`;
  wrapper.position.set(view.object.position.x, view.object.position.y);
  wrapper.rotation = view.object.rotation;
  wrapper.scale.set(view.object.scale.x, view.object.scale.y);
  wrapper.zIndex = view.object.zIndex;

  if (container !== null) {
    container.addChildAt(wrapper, Math.max(0, container.children.indexOf(view.object)));
  }

  view.object.position.set(0, 0);
  view.object.rotation = 0;
  view.object.zIndex = 0;
  view.object.scale.set(view.kind === "Sprite" && view.placeholder ? PLACEHOLDER_SIZE : 1);
  wrapper.addChild(view.object);
  view.wrapper = wrapper;

  return wrapper;
}

/**
 * Hangs a view where it belongs: under its parent's wrapper, or in the container of the layer
 * it names. An entity with no layer and no parent is not drawn.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function attach(sctx: SyncCtx, entity: Entity, view: View): void {
  const state = sctx.ctx.state.sync;
  const parentEntity = sctx.ctx.deps.world.ecs.get(entity, Parent)?.entity ?? 0;

  if (parentEntity !== 0 && parentEntity !== entity) {
    const wrapper = ensureWrapper(sctx, parentEntity);

    view.layer = "";

    if (wrapper === undefined) {
      sctx.ctx.log.warn("renderer: parent draws nothing", { entity, parent: parentEntity });
      detach(view.object);

      return;
    }

    wrapper.addChild(view.wrapper ?? view.object);

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
 * Builds the view of one entity and hangs it in the tree.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns True when a view was built now; false when one exists or nothing is drawable.
 */
export function createView(sctx: SyncCtx, entity: Entity): boolean {
  const state = sctx.ctx.state.sync;

  if (state.views.has(entity)) return false;

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
    display: visual.display,
    value: built.value,
    hitBox: { x: 0, y: 0, width: 0, height: 0 }
  };

  object.label = labelOf(sctx, nameOf(visual), entity);
  state.views.set(entity, view);
  state.entityOf.set(object, entity);
  if (visual.textureKey !== "") trackKey(state, entity, visual.textureKey);

  writeVisual(sctx, entity, view);
  applyTransform(sctx, entity, view);
  attach(sctx, entity, view);
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
 * @param wrapper - Its wrapper.
 */
function detachChildren(sctx: SyncCtx, entity: Entity, wrapper: PixiContainer): void {
  const orphans: Entity[] = [];

  for (const [child, childView] of sctx.ctx.state.sync.views) {
    if (child === entity) continue;

    const object = childView.wrapper ?? childView.object;

    if (object.parent !== wrapper) continue;

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

  if (view.wrapper !== undefined) detachChildren(sctx, entity, view.wrapper);

  state.views.delete(entity);
  state.entityOf.delete(view.object);
  untrackKey(state, entity, view.textureKey);
  release(sctx, view);
}

/**
 * Drops every view, every layer and every pool. Works on the state alone, because `onStop` has
 * no context. A `Display` object belongs to the game: it is detached, never destroyed.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopSync(state: SyncState): void {
  for (const off of state.cleanups) off();
  state.cleanups.length = 0;

  for (const view of state.views.values()) {
    if (view.kind === "Display") detach(view.object);

    if (view.kind === "adapter") {
      detach(view.object);
      view.display?.adapter.destroy(view.object);
    }

    view.mask = undefined;
    view.wrapper = undefined;
  }

  clearAdapters(state);
  clearFonts(state);
  state.views.clear();
  state.entityOf.clear();
  state.byKey.clear();
  state.invalidated.clear();
  state.warned.clear();
  state.added.clear();
  state.removed.clear();
  state.providers.length = 0;

  clearLayers(state);
  destroyPools(state);
  state.root?.destroy({ children: true });
  state.root = undefined;
}
