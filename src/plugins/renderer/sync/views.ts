/**
 * @file renderer/sync — one view per entity: build it from the components, write every value,
 * hang it in its layer or under its parent, and give it back to the pool when it leaves.
 */
import { Layer } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import { Display, NineSlice, Parent, Sprite, Transform } from "../components";
import type { PixiContainer, PixiTexture } from "../types";
import { labelOf } from "./labels";
import { clearLayers, layerContainer, resort } from "./layers";
import { acquire, destroyPools, detach, isNineSlice, isSprite, poolKeyOf, release } from "./pools";
import {
  PLACEHOLDER_SIZE,
  PLACEHOLDER_TINT,
  placeholderTexture,
  resolveTexture,
  trackKey,
  untrackKey,
  warnMissing
} from "./textures";
import type { SyncCtx, SyncState, View, ViewKind } from "./types";

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
export function visualOf(
  sctx: SyncCtx,
  entity: Entity
): { kind: ViewKind; textureKey: string } | undefined {
  const ecs = sctx.ctx.deps.world.ecs;
  const found: Array<{ kind: ViewKind; textureKey: string }> = [];
  const sprite = ecs.get(entity, Sprite);
  const nine = ecs.get(entity, NineSlice);

  if (sprite !== undefined) found.push({ kind: "Sprite", textureKey: sprite.texture });
  if (nine !== undefined) found.push({ kind: "NineSlice", textureKey: nine.texture });
  if (ecs.has(entity, Display)) found.push({ kind: "Display", textureKey: "" });

  if (found.length > 1) {
    sctx.ctx.log.warn("renderer: entity has more than one visual", {
      entity,
      kinds: found.map(entry => entry.kind)
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
function makeObject(
  sctx: SyncCtx,
  entity: Entity,
  visual: { kind: ViewKind; textureKey: string }
): PixiContainer | undefined {
  if (visual.kind === "Display") return displayObjectOf(sctx, entity);

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return undefined;

  const pooled = acquire(sctx.ctx.state.sync, poolKeyOf(visual.kind, visual.textureKey));

  if (pooled !== undefined) return pooled;
  if (visual.kind === "Sprite") return new pixi.Sprite(pixi.Texture.WHITE);

  return new pixi.NineSliceSprite({ texture: pixi.Texture.WHITE });
}

/**
 * Builds the view of one entity and hangs it in the tree.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 */
export function createView(sctx: SyncCtx, entity: Entity): void {
  const state = sctx.ctx.state.sync;

  if (state.views.has(entity)) return;

  const visual = visualOf(sctx, entity);

  if (visual === undefined) return;

  const object = makeObject(sctx, entity, visual);

  if (object === undefined) return;

  const view: View = {
    object,
    kind: visual.kind,
    poolKey: poolKeyOf(visual.kind, visual.textureKey),
    layer: "",
    textureKey: visual.textureKey,
    wrapper: undefined,
    placeholder: false,
    hitBox: { x: 0, y: 0, width: 0, height: 0 }
  };

  object.label = labelOf(sctx, visual.kind, entity);
  state.views.set(entity, view);
  state.entityOf.set(object, entity);
  if (visual.textureKey !== "") trackKey(state, entity, visual.textureKey);

  writeVisual(sctx, entity, view);
  applyTransform(sctx, entity, view);
  attach(sctx, entity, view);
  resort(sctx, entity, view);
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
    view.wrapper = undefined;
  }

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
