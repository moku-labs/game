/**
 * @file renderer/sync — type definitions: the one system that owns every display object.
 */
import type { Entity } from "../../world/ecs/types";
import type { LayerSort, LayerSpec } from "../../world/projection/types";
import type { HostApi, HostInternal } from "../host/types";
import type { PixiContainer, PixiTexture, RendererCtx } from "../types";
import type { ViewportApi, ViewportInternal } from "../viewport/types";

/**
 * Which component gave an entity its display object.
 *
 * @example
 * ```ts
 * const kind: ViewKind = "NineSlice";
 * ```
 */
export type ViewKind = "Sprite" | "NineSlice" | "Display";

/**
 * The rectangle a hit test checks, in the local space of the view: anchor already applied.
 *
 * @example
 * ```ts
 * const box: HitBox = { x: -32, y: -32, width: 64, height: 64 };
 * ```
 */
export type HitBox = { x: number; y: number; width: number; height: number };

/**
 * What `sync` knows about one drawn entity.
 *
 * @example
 * ```ts
 * const view: View = {
 *   object: sprite, kind: "Sprite", poolKey: "Sprite:board.cell", layer: "items",
 *   textureKey: "board.cell", wrapper: undefined, placeholder: false,
 *   hitBox: { x: -32, y: -32, width: 64, height: 64 }
 * };
 * ```
 */
export type View = {
  object: PixiContainer;
  kind: ViewKind;
  /** `kind + ":" + texture key`, the pool this object goes back to. */
  poolKey: string;
  /** Name of the layer container the object hangs in, or `""` while it is parented. */
  layer: string;
  textureKey: string;
  /** The container that holds this entity's children, created when it is first named a parent. */
  wrapper: PixiContainer | undefined;
  /** No provider answered: the view draws the 64x64 magenta square until a bundle arrives. */
  placeholder: boolean;
  hitBox: HitBox;
};

/**
 * One layer of the scene: its container and the sort rule its children follow.
 *
 * @example
 * ```ts
 * const entry: LayerEntry = { container: itemsContainer, sort: "y" };
 * ```
 */
export type LayerEntry = { container: PixiContainer | undefined; sort: LayerSort };

/**
 * A texture source `assets` registered.
 *
 * @example
 * ```ts
 * const provider: TextureProvider = key => loaded.get(key);
 * ```
 */
export type TextureProvider = (key: string) => PixiTexture | undefined;

/**
 * Nine-slice borders in pixels: left, top, right, bottom.
 *
 * @example
 * ```ts
 * const borders: NineBorders = [12, 12, 12, 12];
 * ```
 */
export type NineBorders = readonly [number, number, number, number];

/**
 * Options of `textures.create`.
 *
 * @example
 * ```ts
 * const options: CreateTextureOptions = { nine: [12, 12, 12, 12] };
 * ```
 */
export type CreateTextureOptions = { nine?: NineBorders };

/**
 * The texture registry `assets` drives, `app.renderer.sync.textures`. The renderer makes and
 * destroys Pixi textures on request; `assets` owns when that happens.
 *
 * @example
 * ```ts
 * // `assets` decoded a file, hands the bitmap over and answers for the key from then on.
 * const texture = app.renderer.sync.textures.create(bitmap);
 * app.renderer.sync.textures.invalidate(["board.cell"]);
 * ```
 */
export type TexturesApi = {
  /**
   * Adds a provider to the chain. The newest provider is asked first.
   *
   * @param fn - Answers a texture for an asset key, or `undefined`.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // `assets` publishes its loaded bundles in onStart and takes them back in onStop.
   * const renderer = ctx.require(rendererPlugin);
   * const off = renderer.sync.textures.provide(key => ctx.state.loaded.get(key));
   *
   * off(); // `assets` stops
   * ```
   */
  provide(fn: TextureProvider): () => void;

  /**
   * Makes a Pixi texture from a decoded image, so `assets` never imports Pixi.
   *
   * @param image - The decoded image.
   * @param options - `nine` is left, top, right and bottom in pixels; it becomes the texture's
   *   default nine-slice borders.
   * @returns The new texture.
   * @throws {Error} When the renderer does not draw.
   * @example
   * ```ts
   * // `assets` uploads one file of a bundle it just decoded.
   * const renderer = ctx.require(rendererPlugin);
   * const bitmap = await createImageBitmap(await response.blob());
   * const texture = renderer.sync.textures.create(bitmap, { nine: [12, 12, 12, 12] });
   * ```
   */
  create(image: ImageBitmap | HTMLImageElement, options?: CreateTextureOptions): PixiTexture;

  /**
   * Destroys a texture and its source. Destroying the same texture twice is a no-op.
   *
   * @param texture - The texture to free.
   * @example
   * ```ts
   * // `assets` unloads a bundle: first the views let go, then the GPU memory is freed.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.textures.invalidate(["board.cell"]);
   * renderer.sync.textures.destroy(texture);
   * ```
   */
  destroy(texture: PixiTexture): void;

  /**
   * Marks asset keys stale. Every view that uses one resolves again in the next pass, and the
   * pooled objects of these keys are destroyed at once.
   *
   * @param keys - The asset keys a bundle brought or took away.
   * @example
   * ```ts
   * // A lazy bundle arrived: the magenta placeholders become the art on the next frame.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.textures.invalidate(["board.chain-1", "board.chain-2"]);
   * ```
   */
  invalidate(keys: readonly string[]): void;
};

/**
 * sync module API, `app.renderer.sync`. The one owner of every display object: it builds them
 * from components, sorts them inside the named layers of the scene and answers hit tests.
 *
 * @example
 * ```ts
 * // `input` turns a pointer position into the entity under the finger.
 * app.renderer.sync.hitTest(540, 300, entity => !app.world.ecs.has(entity, Exiting)); // 1048576
 * ```
 */
export type SyncApi = {
  /**
   * The topmost entity whose hit box holds the point and which `accept` allows. Pure component
   * math: Pixi world matrices are one frame behind at input time.
   *
   * @param x - Reference x.
   * @param y - Reference y.
   * @param accept - Filter of the caller: the first accepted entity wins.
   * @returns The entity, or `undefined` when nothing was hit. Inert: always `undefined`.
   * @example
   * ```ts
   * // `input` never picks a view that is on its way out.
   * const renderer = ctx.require(rendererPlugin);
   * const world = ctx.require(worldPlugin);
   * renderer.sync.hitTest(540, 300, entity => !world.ecs.has(entity, Exiting)); // 1048576
   * ```
   */
  hitTest(x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined;

  /**
   * The texture registry `assets` drives.
   */
  textures: TexturesApi;

  /**
   * The Pixi object of an entity, for debugging and for the plugins that draw their own thing.
   *
   * @param entity - The entity to ask about.
   * @returns The display object, or `undefined` when the entity draws nothing.
   * @example
   * ```ts
   * // An e2e test reads the label the renderer wrote, to find the view in the Pixi tree.
   * const object = app.renderer.sync.displayOf(entity);
   * (object as { label: string }).label; // "Sprite#1048576 board.items:i5"
   * ```
   */
  displayOf(entity: Entity): unknown | undefined;
};

/**
 * sync methods driven by the plugin root and by a device restore. Not public.
 */
export type SyncInternal = {
  /**
   * Creates the root container, registers the world hooks and the `renderer.sync` system, and
   * builds the views of the entities that already exist.
   */
  start(): void;

  /**
   * Drops every view, rebuilds the root, the layers and every view. Used after a restore, where
   * the old application and all its objects are gone.
   */
  rebuildAll(): void;

  /**
   * One pass over the change sets: removed, layers, added, changed, invalidated keys.
   */
  pass(): void;

  /**
   * Lets go of the whole tree while it is still alive: the objects the game owns are detached,
   * the pooled ones are destroyed. Called just before a lost application is destroyed.
   */
  forget(): void;

  /**
   * The root container, so the plugin root can re-apply the viewport transform after a resize.
   *
   * @returns The root, or `undefined` while inert.
   */
  root(): PixiContainer | undefined;
};

/**
 * sync module state.
 */
export type SyncState = {
  /** The container the viewport transform is written on. Its children are the layers. */
  root: PixiContainer | undefined;
  /** The list last read from `world.projection.layers()`, compared by reference. */
  layerList: ReadonlyArray<LayerSpec> | undefined;
  layers: Map<string, LayerEntry>;
  views: Map<Entity, View>;
  /** The back reference from a display object to its entity. */
  entityOf: Map<object, Entity>;
  pools: Map<string, PixiContainer[]>;
  pooled: number;
  providers: TextureProvider[];
  /** Texture key to the entities that use it, for `invalidate`. */
  byKey: Map<string, Set<Entity>>;
  invalidated: Set<string>;
  /** Keys already reported missing, so one key warns once. */
  warned: Set<string>;
  added: Set<Entity>;
  removed: Set<Entity>;
  cleanups: Array<() => void>;
};

/**
 * What `sync` gets injected: the two modules below it.
 */
export type SyncDeps = { host: HostApi & HostInternal; viewport: ViewportApi & ViewportInternal };

/**
 * Domain context of the sync module.
 */
export type SyncCtx = { ctx: RendererCtx; deps: SyncDeps };
