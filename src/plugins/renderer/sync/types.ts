/**
 * @file renderer/sync — type definitions: the one system that owns every display object.
 */
import type { ComponentHandle, EcsApi, Entity, LayerSort, LayerSpec } from "../../world/types";
import type { OverlayValue } from "../components";
import type { Unseen } from "../demand/types";
import type { HostApi, HostInternal } from "../host/types";
import type { FilterCache, KeptState } from "../kept/types";
import type {
  DemandModule,
  KeptModule,
  OverlayEventDetail,
  PerfEventName,
  PixiBitmapFont,
  PixiBounds,
  PixiContainer,
  PixiFilter,
  PixiFilterManager,
  PixiGraphics,
  PixiModule,
  PixiRectangle,
  PixiRenderTexture,
  PixiSprite,
  PixiTexture,
  RendererCtx
} from "../types";
import type { Point, ViewportApi, ViewportInternal } from "../viewport/types";
import type { HiddenCtx, HiddenReason } from "./hidden";

/**
 * Which component gave an entity its display object. `"adapter"` is a component a plugin above
 * registered with `displays.provide`.
 */
export type ViewKind = "Sprite" | "NineSlice" | "Shape" | "Display" | "adapter";

/**
 * How a component of a plugin above becomes a display object. The renderer parents, orders and
 * frees the object like a sprite; the plugin decides what it is.
 *
 * @example
 * ```ts
 * const adapter: DisplayAdapter<{ resolved: string }> = {
 *   create: value => buildRuns(value.resolved),
 *   // false: the same string, nothing drawn changes, so a renderer drawing on demand skips the frame
 *   update: (object, previous, next) => previous.resolved !== next.resolved && rebuild(object, next.resolved),
 *   destroy: object => (object as Container).destroy({ children: true, texture: false })
 * };
 * ```
 */
export type DisplayAdapter<Value extends object = object> = {
  /**
   * Builds the display object of one entity. Called on the first pass after the component
   * appeared, and never while the renderer is inert.
   *
   * @param value - The component value.
   * @param entity - The entity it sits on.
   * @returns A Pixi container.
   */
  create(value: Readonly<Value>, entity: Entity): unknown;

  /**
   * Writes a changed component value onto the object the adapter built.
   *
   * @param object - What `create` returned.
   * @param previous - The value of the last pass.
   * @param next - The value now.
   * @returns `false` when nothing drawn changed, so a renderer drawing on demand skips the frame; anything else
   *   (`true`, nothing) marks the view.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: an adapter typed `: void` before keeps compiling; `void` names that honestly
  update(object: unknown, previous: Readonly<Value>, next: Readonly<Value>): boolean | void;

  /**
   * Frees the object. Called when the component or the entity leaves, and when the renderer stops.
   *
   * @param object - What `create` returned.
   */
  destroy(object: unknown): void;
};

/**
 * One registration of `displays.provide`: the component, its adapter and the world hooks that
 * watch the component.
 */
export type DisplayEntry = {
  component: ComponentHandle<object>;
  adapter: DisplayAdapter;
  /** The `onAdded` and `onRemoved` removers of this registration. */
  removers: Array<() => void>;
};

/**
 * A rectangle: the one a hit test checks, in the local space of the view with the anchor already
 * applied, or the bounds of a view in reference units.
 *
 * @example
 * ```ts
 * // A 64 x 64 sprite with the default anchor, in its own units.
 * const box: HitBox = { x: -32, y: -32, width: 64, height: 64 };
 * ```
 */
export type HitBox = { x: number; y: number; width: number; height: number };

/**
 * The fields of a `Shape` last drawn into its `Graphics`: an equal value draws no path again. A fill-only shape is
 * `tinted`: its path is drawn white and its fill is the object's tint, so its `fill` is not compared. Private to `sync`.
 */
export type DrawnShape = {
  /** Drawn white, coloured by the object's tint (no stroke); false for a shape painted in its own colours. */
  tinted: boolean;
  kind: "rect" | "triangle";
  w: number;
  h: number;
  fill: number;
  fillAlpha: number;
  radius: number;
  stroke: number;
  strokeWidth: number;
  dash: number;
};

/**
 * The fields of the clip rectangle last drawn into a view's mask: an equal value draws no mask again. Private to
 * `sync`.
 */
export type ClipDrawn = { kind: "rect" | "triangle"; w: number; h: number; radius: number };

/**
 * What `sync` knows about one drawn entity.
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
  /** The rectangle a `clip: true` shape or nine-slice masks its children with. */
  mask: PixiGraphics | undefined;
  /**
   * The masked container the children hang in while the entity clips, inside its wrapper. The
   * entity's own visual stays outside it, so the mask never cuts its stroke.
   */
  clipped: PixiContainer | undefined;
  /** The registration that built the object, for a component a plugin above draws its own way. */
  display: DisplayEntry | undefined;
  /** A copy of the component value the adapter last saw, so `update` gets an honest `previous`. */
  value: Readonly<object> | undefined;
  /**
   * How much the object is stretched from its texture to the box it draws, per axis: box over
   * texture for a sized sprite, 64 for the 1x1 placeholder, 1 for everything else.
   */
  drawScale: Point;
  /** The crop a `"cover"` sprite shows, as its `frames` key; `""` when it shows none. */
  frameKey: string;
  /** The debug outline of a nine-slice, in its wrapper; `undefined` while debug is off. */
  outline: PixiGraphics | undefined;
  hitBox: HitBox;
  /** What the `Graphics` of a `Shape` was last drawn with; `undefined` before its first draw. */
  drawn: DrawnShape | undefined;
  /** What the mask of a clipping view was last drawn with; `undefined` while it clips nothing. */
  clipDrawn: ClipDrawn | undefined;
  /** The reasons that hide the visual itself (`hidden.ts`). */
  hiddenSelf: number;
  /** The reasons that hide the whole subtree, on the top (`hidden.ts`). */
  hiddenTop: number;
  /** The HUD factor an overlay fades this view with (a `HudPart`), 1 for every other view (spec 22 O7). */
  hud: number;
};

/**
 * The crop of a `"cover"` sprite: a texture that shows the part of `base` covering one box.
 * Cached by texture key and box size, shared by the entities in `users`, and freed when the last
 * of them lets go or when its base is destroyed.
 */
export type CoverFrame = { base: PixiTexture; texture: PixiTexture; users: Set<Entity> };

/**
 * The one world read the pose helpers need, so a caller passes `world.ecs` as it is.
 */
export type PoseReader = Pick<EcsApi, "get">;

/**
 * One layer of the scene: its container, the sort rule its children follow, the reasons that hide the container
 * (`hidden.ts`), and whether it is the scene's HUD layer (`above: "overlays"`).
 */
export type LayerEntry = {
  container: PixiContainer | undefined;
  sort: LayerSort;
  hidden: number;
  hud: boolean;
};

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
 * Options of `textures.create`. `nine` gives the default nine-slice borders in pixels; `mips`
 * uploads the texture with its full mip chain, which Pixi builds on the GPU (`slice` ignores it:
 * a slice shares the source of its page).
 *
 * @example
 * ```ts
 * const options: CreateTextureOptions = { nine: [12, 12, 12, 12], mips: true };
 * ```
 */
export type CreateTextureOptions = { nine?: NineBorders; mips?: true };

/**
 * Where `textures.slice` cuts a texture out of an atlas page, in page pixels. The manifest `atlas`
 * field of `assets` carries it with the page id next to it, and passes as it is.
 *
 * @example
 * ```ts
 * const frame: SliceFrame = { x: 583, y: 595, width: 256, height: 128 };
 * ```
 */
export type SliceFrame = { x: number; y: number; width: number; height: number };

/**
 * The texture registry `assets` drives, `app.renderer.sync.textures`. The renderer makes and
 * destroys Pixi textures on request; `assets` owns when that happens.
 *
 * @example
 * ```ts
 * // `assets` decoded a file of a bundle: it uploads it, then the views of the key draw it.
 * const renderer = ctx.require(rendererPlugin);
 * const bitmap = await createImageBitmap(await (await fetch("/assets/board/cell.png")).blob());
 * const texture = renderer.sync.textures.create(bitmap); // texture.width === bitmap.width
 * renderer.sync.textures.invalidate(["board.cell"]); // the next pass resolves "board.cell" again
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
   *   default nine-slice borders. `mips: true` uploads the full mip chain, generated on the GPU.
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
   * Cuts a texture out of an atlas page, so `assets` never imports Pixi. The slice shares the
   * page's source: no pixel is copied, and the page keeps the GPU memory. A frame is measured
   * from the page's own frame, so a slice of a slice lands where it should.
   *
   * @param page - The page texture `create` made.
   * @param frame - The frame in page pixels.
   * @param options - `nine` is left, top, right and bottom in pixels; it becomes the slice's
   *   default nine-slice borders.
   * @returns The slice. `destroy` frees only this wrapper, never the page's source.
   * @throws {Error} When the renderer does not draw, and when the frame does not fit in the page
   *   (a manifest packed for other pages).
   * @example
   * ```ts
   * // `assets`: the page "ui/main-0" landed; the packed button texture is cut out of it with its borders.
   * const renderer = ctx.require(rendererPlugin);
   * const button = renderer.sync.textures.slice(page, { x: 583, y: 595, width: 256, height: 128 }, { nine: [24, 24, 24, 24] });
   * button.width; // 256
   * button.defaultBorders; // { left: 24, top: 24, right: 24, bottom: 24 }
   * renderer.sync.textures.destroy(button); // the wrapper goes, the page's source stays
   * ```
   */
  slice(page: PixiTexture, frame: SliceFrame, options?: CreateTextureOptions): PixiTexture;

  /**
   * Destroys a texture and its source. A slice loses only its wrapper: the source belongs to its
   * page, which frees it. The crops of `"cover"` sprites cut from the texture go with it.
   * Destroying the same texture twice is a no-op.
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
 * The display registry a plugin above extends, `app.renderer.sync.displays`. `Sprite`,
 * `NineSlice` and `Shape` are built in; everything else arrives as an adapter.
 *
 * @example
 * ```ts
 * // `text` teaches the renderer to draw its own component, and takes it back in onStop.
 * const off = ctx.require(rendererPlugin).sync.displays.provide(Text, textAdapter);
 * ```
 */
export type DisplaysApi = {
  /**
   * Registers how a component becomes a display object. The renderer calls `create` on the first
   * pass after the component appeared, `update` on every change, and `destroy` when it leaves.
   *
   * @param component - The component the plugin owns.
   * @param adapter - How that component is built, written and freed.
   * @returns The remover; calling it twice is a no-op. The views built with it stay until their
   *   entities leave or the renderer stops.
   * @example
   * ```ts
   * // `text` draws its labels with BitmapText, and stops drawing them when it stops.
   * const renderer = ctx.require(rendererPlugin);
   * const off = renderer.sync.displays.provide(Text, createTextAdapter(ctx));
   *
   * off(); // `text` stops: the renderer builds no new label
   * ```
   */
  provide<Value extends object>(
    component: ComponentHandle<Value>,
    adapter: DisplayAdapter<Value>
  ): () => void;
};

/**
 * The bitmap fonts of the one Pixi application, `app.renderer.sync.fonts`. `assets` loads the
 * files, `text` hands them over, the renderer owns the installed font.
 *
 * @example
 * ```ts
 * // `text` installs the font of a bundle that just landed, once.
 * const renderer = ctx.require(rendererPlugin);
 * const font = ctx.require(assetsPlugin).font("hud.body");
 *
 * if (font !== undefined && !renderer.sync.fonts.installed("hud.body")) {
 *   renderer.sync.fonts.install("hud.body", font.fnt, font.texture);
 * }
 * ```
 */
export type FontsApi = {
  /**
   * Installs a BMFont file and its page texture under an asset key, so a `BitmapText` with that
   * key as its `fontFamily` draws with it.
   *
   * @param key - The asset key of the font.
   * @param fnt - The `.fnt` file: BMFont text, BMFont XML or BMFont JSON.
   * @param texture - The page texture `assets` uploaded.
   * @throws {Error} When the renderer does not draw, which is every headless run.
   * @example
   * ```ts
   * // `text` installs the boot font after the renderer came up.
   * const renderer = ctx.require(rendererPlugin);
   * const font = ctx.require(assetsPlugin).font("hud.body");
   *
   * if (renderer.host.ready() && font !== undefined) {
   *   renderer.sync.fonts.install("hud.body", font.fnt, font.texture);
   * }
   * ```
   */
  install(key: string, fnt: string, texture: PixiTexture): void;

  /**
   * Tells whether a font key is installed in this application.
   *
   * @param key - The asset key of the font.
   * @returns True when the font is there.
   * @example
   * ```ts
   * // `text` measures with the real advance table only once the font is in the renderer.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.fonts.installed("hud.body"); // false before the boot bundle landed
   * ```
   */
  installed(key: string): boolean;
};

/**
 * One filter on an entity's view: a Pixi filter instance `effects` built, how many render passes
 * one apply of it costs, the filter kind id the performance log names it by, and what the
 * kept-picture cache may do with it.
 *
 * @example
 * ```ts
 * // A full-screen blur of quality 4 applies 8 times.
 * const blurSlot: FilterSlot = { filter: blur, passes: 8, kind: "blur", cache: "local", blurs: true };
 * const slot: FilterSlot = { filter: glow, passes: 1, kind: "effects.glow", cache: "local" };
 * ```
 */
export type FilterSlot = {
  filter: PixiFilter;
  passes: number;
  /** The filter kind id, for the performance log; optional: a slot without it counts as "other". */
  kind?: string;
  /** The stages of a filter's inputs and the seam of the kept-picture cache; filled by effects, left out by a game. */
  inputs?: FilterSlotInputs;
  /** What the kept-picture cache may do with the filter; left out, it is `"screen"` (drawn live). */
  cache?: FilterCache;
  /** The filter's `keptOrigin` uniform, which the renderer sets to the canvas origin of a picture. */
  origin?: Float32Array;
  /**
   * The filter shows a blurred copy of what is under it (the built-in `Blur`, a filter with inputs); an overlay over
   * it holds the loops under it (spec 22).
   */
  blurs?: boolean;
};

/**
 * The stages of a filter's inputs and the seam of the kept-picture cache, on the filter's slot. `effects` fills it;
 * a game's own slots leave it out.
 *
 * @example
 * ```ts
 * // The kept-picture cache (spec 23) reads the Frost slot it keeps for the ward's root.
 * slot.inputs?.count; // 1
 * ```
 */
export type FilterSlotInputs = {
  /**
   * The Pixi filter of every place of every chain, in draw order; the monitor counts their applies under the slot's kind.
   *
   * @example
   * ```ts
   * slot.inputs?.stages.length; // 4 on the owner's phone: FrostBox4, FrostHalf, FrostGauss, FrostGauss
   * ```
   */
  readonly stages: readonly PixiFilter[];
  /**
   * How many inputs the filter reads.
   *
   * @example
   * ```ts
   * slot.inputs?.count; // 1 for the Frost
   * ```
   */
  readonly count: number;
  /**
   * A number that changes whenever what the stages draw changes: another step list, scale or stage uniform, or another
   * resolution. Read it after `draw`.
   *
   * @returns The version; 1 after the first evaluation.
   * @example
   * ```ts
   * // The Frost's panel rect follows the shop sheet sliding in: the chain returns the same steps every frame.
   * slot.inputs?.version(); // 1, and still 1 at the end of the slide
   * ```
   */
  version(): number;
  /**
   * The share of the picture's resolution the result of one input has.
   *
   * @param index - The input, in declaration order.
   * @returns The scale of its last step; `undefined` for an empty chain, whose result is the view's own input.
   * @example
   * ```ts
   * slot.inputs?.scaleOf(0); // 0.125 on the owner's phone
   * ```
   */
  scaleOf(index: number): number | undefined;
  /**
   * Draws the stages of every input from a picture, the last place of input `index` into `targets[index]`; pooled
   * textures in between go back to Pixi's pool before it returns. Call it only from inside a filter's `apply`.
   *
   * @param manager - Pixi's filter system, as the `apply` received it.
   * @param picture - The kept picture of the view's subtree.
   * @param targets - One engine-owned texture per input, of the picture's frame at `scaleOf(index)` × its resolution.
   * @example
   * ```ts
   * // Spec 23 runs the stages once on the kept picture of the ward, inside a filter pass of its own.
   * keeper.apply = (manager, picture) => slot.inputs?.draw(manager, picture, [blurred]);
   * ```
   */
  draw(manager: PixiFilterManager, picture: PixiTexture, targets: readonly PixiTexture[]): void;
  /**
   * Lends kept results to the filter: while held, its apply binds them and draws its main body only.
   *
   * @param results - One texture per input, or `undefined` to end the loan. A filter with an empty chain is never held.
   * @example
   * ```ts
   * slot.inputs?.hold([blurred]); // the next apply of the Frost draws one pass: its body over the kept blur
   * ```
   */
  hold(results: readonly PixiTexture[] | undefined): void;
};

/**
 * The filters drawn on entities' views, `app.renderer.sync.filters`. `effects` builds, writes and
 * destroys the instances; the renderer only hangs them on the view and counts their passes.
 *
 * @example
 * ```ts
 * // `effects` saw the Glow component appear on a button.
 * ctx.require(rendererPlugin).sync.filters.set(button, [{ filter: glow, passes: 1 }]);
 * ```
 */
export type FiltersApi = {
  /**
   * Sets the filters drawn on an entity's view, in draw order. They cover the entity's whole
   * subtree: a glow on a button glows its label too. The list is kept for the entity, so a call
   * made before the view exists lands when it is built, and a pooled or rebuilt view gets it
   * again. Pixi is written only when the instances differ from what the view holds. Works while
   * inert: stored, nothing applied. The renderer never destroys a filter.
   *
   * @param entity - The entity whose view is filtered.
   * @param slots - The filters in draw order, with their passes; `[]` clears them.
   * @example
   * ```ts
   * // `effects`: Glow appeared on a button; one instance per view and kind, one pass per apply.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.filters.set(button, [{ filter: glow, passes: 1 }]);
   * renderer.sync.renderPasses(); // 3: the frame, the button's content pass, one glow apply
   * renderer.sync.filters.set(button, []); // the Glow component left: back to 1
   * ```
   */
  set(entity: Entity, slots: readonly FilterSlot[]): void;

  /**
   * Sets the rectangle outside of which the view's filters draw nothing, in the entity's own units; `undefined` goes
   * back to the view's bounds. Pixi then sizes the filter's textures and its fill to that rectangle, which moves,
   * scales and turns with the view. Outside it Pixi draws nothing of the view at all, neither the filters nor the
   * view's own content. Kept for the entity like its filters: a view built later, pooled or rebuilt gets it again.
   * Works while inert: stored, nothing applied.
   *
   * @param entity - The entity whose view is filtered.
   * @param area - x, y, width, height in the entity's own units, or `undefined`.
   * @example
   * ```ts
   * // `effects`: the lens on the full-screen cover now draws only around its disc.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.filters.area(cover, [107, 101, 176, 176]);
   * renderer.sync.renderPasses(); // 3 as before; the lens pass now fills 176 × 176 units, not the screen
   * renderer.sync.filters.area(cover, undefined); // the lens went: back to the view's bounds
   * ```
   */
  area(entity: Entity, area: readonly [number, number, number, number] | undefined): void;

  /**
   * Creates the GPU pipelines of a filter before a screen needs them: the renderer draws it, invisibly and before a
   * frame, on the canvas and on a texture, with and without a clip (WebGPU; once on WebGL), `renderer.warm` draws a
   * frame. Answers `true` once every draw was made, `false` at once when there is nothing to warm (no device, a headless
   * app, `warm: 0`), and `false` when the renderer stops first or a probe's render threw, which ends the warm-up of the
   * application (`renderer:warm-failed`). A filter handed over again on the same device answers `true` at once when its
   * draws were made. The renderer never destroys the filter.
   *
   * @param filter - A filter the caller built and keeps alive while it waits.
   * @returns Whether the filter's pipelines were created.
   * @example
   * ```ts
   * // `effects`, during the splash: a probe of the Frost's body, before the shop is ever opened.
   * const renderer = ctx.require(rendererPlugin);
   * const warmed = await renderer.sync.filters.warm(frostProbe.filter); // true four drawn frames later (WebGPU, warm: 1)
   * ```
   */
  warm(filter: PixiFilter): Promise<boolean>;
};

/**
 * The debug switches of the renderer: the nine-slice outline, the pixel check of skipped frames, the kept pictures and
 * the overdraw heat map.
 *
 * @example
 * ```ts
 * const switches: DebugSwitches = { nineSlice: true, verifyFrames: false, kept: true, overdraw: false };
 * ```
 */
export type DebugSwitches = {
  nineSlice: boolean;
  verifyFrames: boolean;
  kept: boolean;
  overdraw: boolean;
};

/**
 * The debug drawing of the renderer, `app.renderer.sync.debug`. The switch outlines every
 * nine-slice at once; a single panel asks for its own outline with `NineSlice.debug` (`ui`:
 * `style.debug`).
 *
 * @example
 * ```ts
 * // Check where every panel of the open popup is cut: cyan lines, red where corners overlap.
 * app.renderer.sync.debug.nineSlice(true);
 * app.renderer.sync.debug.state(); // { nineSlice: true, verifyFrames: false, kept: true, overdraw: false }
 * ```
 */
export type DebugApi = {
  /**
   * Turns the outline of every nine-slice on or off. The outline strokes the bounds of the panel
   * and the four lines Pixi cuts its texture at: cyan, red when the corners overlap or the texture
   * is missing. A nine-slice whose own `debug` is true keeps its outline while the switch is off.
   * The views are drawn again on the next pass.
   *
   * @param on - True to outline every nine-slice.
   * @example
   * ```ts
   * // A dev build binds a key: "d" shows where the settings popup cuts its parchment and tabs.
   * globalThis.addEventListener("keydown", event => {
   *   if (event.key === "d") app.renderer.sync.debug.nineSlice(true);
   * });
   * // After the next frame the parchment 1000x1040 with insets 72/76 shows lines at x 72 and
   * // 928, y 76 and 964.
   * ```
   */
  nineSlice(on: boolean): void;

  /**
   * Checks every frame the renderer does not draw against the same frame drawn live, by pixels, and logs
   * `renderer:missed-frame` with the views marked since the last drawn frame when they differ; the frame is then
   * drawn. Works with `onDemand` off too: the renderer decides as if it were on and compares, drawing every frame.
   * Costs a read-back of the canvas each frame: dev and debug builds only; elsewhere the switch stays off.
   *
   * @param on - True to check.
   * @example
   * ```ts
   * // The visual runner checks every stepped frame of a test in the browser.
   * app.renderer.sync.debug.verifyFrames(true);
   * app.renderer.sync.debug.state(); // { nineSlice: false, verifyFrames: true, kept: true, overdraw: false }
   * ```
   */
  verifyFrames(on: boolean): void;

  /**
   * Draws every kept picture live again (false) or lets the renderer keep them (true): the A/B switch of a measurement.
   * Off takes effect in the next drawn frame, all views at once; on lets each view be taken again by the usual rule.
   * Works in every build; with `keptMb: 0` the pictures stay off.
   *
   * @param on - False to draw every filtered view live.
   * @example
   * ```ts
   * // The editor's tools page compares the memory screen with and without kept pictures.
   * app.renderer.sync.debug.kept(false);
   * app.renderer.sync.debug.state(); // { nineSlice: false, verifyFrames: false, kept: false, overdraw: false }
   * ```
   */
  kept(on: boolean): void;

  /**
   * Draws every frame as the overdraw heat map (true) or as the game (false): a pixel's brightness counts the layers
   * drawn there, 1/16 white for one, white for sixteen and more. While it is on every frame is drawn (also with
   * `onDemand`), kept pictures are drawn live and filters are off, so the map shows what a frame would draw without
   * them; the frames of the performance log are marked (`debug` event, header `debug.overdraw`), so a recording is not
   * read as real cost. Only the stage pass changes: between frames every view keeps its own alpha, blend mode and
   * filters, and off draws the game again from the next frame. A texel a texture leaves transparent counts nothing.
   * Dev and debug builds only; elsewhere the switch stays off.
   *
   * @param on - True to draw the heat map.
   * @example
   * ```ts
   * // The editor's Mission control shows where the board stacks its layers: three full-screen backdrops show 3/16 white.
   * app.renderer.sync.debug.overdraw(true);
   * app.renderer.sync.debug.state(); // { nineSlice: false, verifyFrames: false, kept: true, overdraw: true }
   * app.renderer.sync.debug.overdraw(false); // the next frame draws the board as before
   * ```
   */
  overdraw(on: boolean): void;

  /**
   * What every overlay does this frame, bottom first: its phase, its mode, its level, how many entries its range has
   * and whether a picture holds them. The level and the landing are the engine's state of the overlay, read here. For
   * the editor's tools page and for tests.
   *
   * @returns One report per overlay, a fresh array; `[]` with none, and while inert.
   * @example
   * ```ts
   * // The shop rests over the board.
   * app.renderer.sync.debug.overlays();
   * // [{ entity: 1_048_601, label: "Shape#1048601 shop.dim:shopDimLayer", phase: "shown", mode: "freeze", level: 1, range: 2, kept: true }]
   * ```
   */
  overlays(): readonly OverlayReport[];

  /**
   * What the debug switches are set to, as a fresh object.
   *
   * @returns The switches.
   * @example
   * ```ts
   * // An e2e test makes sure no outline is drawn before it compares a screenshot.
   * app.renderer.sync.debug.state(); // { nineSlice: false, verifyFrames: false, kept: true, overdraw: false }
   * ```
   */
  state(): DebugSwitches;
};

/**
 * sync module API, `app.renderer.sync`. The one owner of every display object: it builds them
 * from components, sorts them inside the named layers of the scene and answers hit tests.
 *
 * @example
 * ```ts
 * // `input` turns a pointer position into the entity under the finger.
 * const renderer = ctx.require(rendererPlugin);
 * const world = ctx.require(worldPlugin);
 * renderer.sync.hitTest(540, 300, entity => !world.ecs.has(entity, Exiting)); // 1048576
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
   * Every entity whose hit box holds the point, topmost first: the walk and the skip rules of
   * `hitTest` (a hidden or fully transparent view, a point outside a clipping ancestor), with no
   * filter, so the caller filters. `hitTest` stays the fast path of a pointer event: it stops at
   * the first accepted hit.
   *
   * @param x - Reference x.
   * @param y - Reference y.
   * @returns The entities, topmost first, as a fresh array. Inert, and where nothing is drawn: `[]`.
   * @example
   * ```ts
   * // The `game.at` door lists what lies under a point: a coin drawn over its board cell.
   * app.renderer.sync.hitAll(540, 300); // [1048581, 1048576]
   * app.renderer.sync.hitAll(20, 20); // []: nothing is drawn there
   * ```
   */
  hitAll(x: number, y: number): readonly Entity[];

  /**
   * Where a view is drawn, in reference units: the axis-aligned bounds of the four corners of its
   * hit box brought through its `Transform` and its `Parent` chain, rotation and scale included.
   * Only a view the player can see has bounds, so a located element is one a click reaches.
   *
   * @param entity - The entity to place.
   * @returns The bounds, a fresh object. `undefined` for an entity without a view, a view that
   *   hangs in no tree, a view hidden or with an effective alpha of 0.01 or less on the way to the
   *   root, and bounds without area. Inert: always `undefined`.
   * @example
   * ```ts
   * // The `game.locate` door finds a 64 x 64 coin drawn at (540, 300) with the default anchor.
   * app.renderer.sync.boundsOf(coin); // { x: 508, y: 268, width: 64, height: 64 }
   * ```
   */
  boundsOf(entity: Entity): HitBox | undefined;

  /**
   * The very box `hitTest` tests for a view, in the entity's own units: the anchor applied, before
   * the `Transform` and the `Parent` chain, so no rotation. `boundsOf` is this box brought to
   * reference units.
   *
   * @param entity - The entity to ask about.
   * @returns The box, a fresh object, or `undefined` for an entity without a view.
   * @example
   * ```ts
   * // `input` fits the hit circle of a trace inside a cell: a 64 x 64 Sprite, default anchor.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.hitBoxOf(cell); // { x: -32, y: -32, width: 64, height: 64 }
   * ```
   */
  hitBoxOf(entity: Entity): HitBox | undefined;

  /**
   * The texture registry `assets` drives.
   *
   * @example
   * ```ts
   * // A lazy bundle arrived: `assets` turns the magenta placeholders into the art.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.textures.invalidate(["board.chain-1", "board.chain-2"]);
   * ```
   */
  textures: TexturesApi;

  /**
   * The display registry a plugin above extends with its own component.
   *
   * @example
   * ```ts
   * // `text` draws its labels with BitmapText, and stops drawing them when it stops.
   * const off = ctx.require(rendererPlugin).sync.displays.provide(Text, createTextAdapter(ctx));
   *
   * off(); // `text` stops: the renderer builds no new label
   * ```
   */
  displays: DisplaysApi;

  /**
   * The bitmap fonts of the one application.
   *
   * @example
   * ```ts
   * // `text` measures with the real advance table only once the font is in the renderer.
   * ctx.require(rendererPlugin).sync.fonts.installed("hud.body"); // false before the boot bundle landed
   * ```
   */
  fonts: FontsApi;

  /**
   * The debug drawing: the nine-slice outline.
   *
   * @example
   * ```ts
   * // Check where every panel of the open popup is cut: cyan lines, red where corners overlap.
   * app.renderer.sync.debug.nineSlice(true);
   * app.renderer.sync.debug.state(); // { nineSlice: true, verifyFrames: false, kept: true, overdraw: false }
   * ```
   */
  debug: DebugApi;

  /**
   * The filters `effects` hangs on entities' views.
   *
   * @example
   * ```ts
   * // `effects`: Glow appeared on a button, then left it.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.filters.set(button, [{ filter: glow, passes: 1 }]);
   * renderer.sync.filters.set(button, []); // the Glow component left: the view draws plain
   * ```
   */
  filters: FiltersApi;

  /**
   * The render passes of the frame, the number `stats().renderPasses` reports: 1 for the frame,
   * plus, for every view in the tree with an enabled filter, 1 for its content and the passes of
   * its enabled slots. Read from the slots at call time, with no allocation. Inert: 0.
   *
   * @returns The render passes.
   * @example
   * ```ts
   * // `effects` checks its pass budget once per frame while a view carries a filter.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.sync.filters.set(button, [{ filter: glow, passes: 1 }]);
   * renderer.sync.renderPasses(); // 3: the frame, the button's content pass, one glow apply
   * ```
   */
  renderPasses(): number;

  /**
   * Tells whether the endless cosmetic loops of an entity should write nothing now: its view lies under an opaque
   * overlay that hides it, or in the kept picture of an overlay that blurs what is under it, or the player cannot see
   * it at all — it or a view above it is at alpha 0, or it is a leaf wholly off the screen. A loop that writes nothing
   * keeps its phase from time and stands where it would have been when it writes again. The seam of `anim`: finite
   * tracks never ask. Inert, and for an entity without a view: false.
   *
   * @param entity - The entity a loop is about to write.
   * @param reveals - What the loop writes that could show the view again: `"alpha"` (its alpha), `"place"` (where it
   *   is or how large), `"both"`. Such a loop is not held for the view's own alpha 0 (`"alpha"`) or for being off the
   *   screen (`"place"`), since its next write may bring the view back.
   * @returns True when the write would change nothing the player can see.
   * @example
   * ```ts
   * // anim, before a forever blink writes the alpha of a pill's glint sprite that rests at alpha 0:
   * ctx.require(rendererPlugin).sync.loopsHeld(track.entity, "alpha"); // false: the blink's next write may show it
   * // the same sprite's forever tint loop, which reveals nothing:
   * ctx.require(rendererPlugin).sync.loopsHeld(track.entity); // true: nothing of it is drawn, the loop's clock runs on
   * ```
   */
  loopsHeld(entity: Entity, reveals?: "alpha" | "place" | "both"): boolean;

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
   * One pass over the change sets: removed, layers, added, changed, the views that lost their `Parent`, the orphans
   * whose parent has a view now, the adapters' values, the invalidated keys and the nine-slice switch.
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

  /**
   * How many display objects `sync` holds, for the counters of `monitor`.
   *
   * @returns The views of entities and the objects waiting in the pools.
   */
  counts(): SyncCounts;

  /**
   * The container of one layer of the scene, so `monitor` can leave a layer out of a picture.
   *
   * @param name - Layer name.
   * @returns The container, or `undefined` for a name the scene does not declare and while inert.
   */
  layerContainer(name: string): PixiContainer | undefined;

  /**
   * The layer an entity is drawn in: the `Layer` of the root of its `Parent` chain, since a child
   * draws with its parent. An entity without a parent names its own.
   *
   * @param entity - The entity.
   * @returns The layer name, or `undefined` when the root of the chain has no `Layer`.
   */
  layerOf(entity: Entity): string | undefined;

  /** The overlays of this frame: modes, ranges, reasons, dims, HUD parts, and the pictures to take (spec 22). */
  stepOverlays(): void;

  /**
   * The `Graphics` paths the engine drew since the last call (shapes, clip masks, nine-slice outlines), and zeroes the
   * count: the monitor's `stats().redraws` (spec 26 R2.3).
   *
   * @returns The paths drawn.
   */
  takeRedraws(): number;

  /**
   * Hands the `overlay` event lines the step queued (agent builds only) to the monitor, oldest first, and forgets them.
   *
   * @param monitor - The monitor's event writer.
   */
  drainOverlayEvents(monitor: OverlayEventSink): void;

  /**
   * Draws up to `renderer.warm` probes of the pipeline warm-up (F4), in a drawn frame, before the kept pictures and the
   * stage pass, which clears the canvas. Asks for the next frame while probes wait. Allocates nothing while the queue
   * is empty.
   *
   * @returns True when it drew a probe in this frame: the frame is then no sample of the adaptive rate.
   */
  warmStep(): boolean;

  /**
   * Subscribes to the end of a warm-up run: the queue became empty (the monitor of an agent build writes the `warm`
   * event line). Emptied by `stopSync`.
   *
   * @param fn - Called with the probe draws made since the queue last started.
   */
  onWarm(fn: WarmListener): void;

  /**
   * Whether the overdraw heat map draws: the frame then asks to be drawn, and the stage pass goes through
   * `drawOverdraw`.
   *
   * @returns True while `debug.overdraw` is on.
   */
  overdrawing(): boolean;

  /**
   * Draws the stage pass as the overdraw heat map and puts every node back after it (`overdraw.ts`).
   *
   * @param render - The stage pass, `host.render`.
   * @returns What `render` answered.
   */
  drawOverdraw(render: () => boolean): boolean;

  /**
   * Subscribes to a move of the overdraw switch (the monitor of an agent build writes the `debug` event line).
   * Emptied by `stopSync`.
   *
   * @param fn - Called with the switch, when it moved.
   */
  onOverdraw(fn: (on: boolean) => void): void;

  /**
   * Gives the view of an entity its wrapper before the kept cache takes its first picture (spec 23 D4), so the
   * picture's root is a plain container; marks nothing, since the wrapper draws the same pixels. The wrapper stays
   * until the view leaves.
   *
   * @param entity - The entity.
   * @returns The wrapper, or `undefined` when the entity has no view or Pixi is not loaded.
   */
  wrapForPicture(entity: Entity): PixiContainer | undefined;
};

/**
 * A listener of the end of a warm-up run: the probe draws made since its queue last started.
 */
export type WarmListener = (draws: number) => void;

/**
 * The rectangle `effects` set for an entity's filters, in the entity's own units, and the one Pixi `Rectangle` it is
 * written into, made at its first write and kept for the entity's life. Not public.
 */
export type AreaEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rect: PixiRectangle | undefined;
};

/**
 * What one probe draw of the warm-up draws: a content subject of the renderer (the batch pipeline of sprites, the
 * graphics pipe's own, particles with either blend, distance-field text), or a filter handed to `filters.warm`.
 */
export type WarmSubject =
  | "sprite"
  | "graphics"
  | "particles-normal"
  | "particles-add"
  | "text"
  | PixiFilter;

/**
 * Where a probe draws: straight onto the canvas, or into a texture under a filter of the module's own, each with or
 * without a stencil clip. A WebGPU pipeline is keyed by all four.
 */
export type WarmVariant = "canvas" | "canvas+clip" | "texture" | "texture+clip";

/**
 * One probe draw: one subject in one variant.
 */
export type WarmDraw = { readonly subject: WarmSubject; readonly variant: WarmVariant };

/**
 * The probe tree, made at the first warm frame and destroyed by `stopSync` and a rebuild: the root that is rendered,
 * the clip (a container masked by a 4 × 4 graphics beside it, as `sync` hangs clips), the texture holder (filtered by
 * the module's own alpha filter), the holder a filter subject hangs on, and the content subjects. None of it is ever in
 * the stage.
 */
export type WarmObjects = {
  root: PixiContainer;
  /** Holds `clip` and `mask`. */
  clipFrame: PixiContainer;
  /** Masked by `mask`; the subject hangs in it for a clip variant. */
  clip: PixiContainer;
  mask: PixiGraphics;
  /**
   * The texture a texture variant is rendered into: the module's own, so the subject is drawn into a texture with no
   * filter around it, and a texture variant never touches the canvas.
   */
  target: PixiRenderTexture;
  /** A filter subject's container: its `filters` is the draw's filter, during the draw only. */
  holder: PixiContainer;
  /** The one-entry list `holder.filters` is set from. */
  list: PixiFilter[];
  sprite: PixiSprite;
  graphics: PixiGraphics;
  particlesNormal: PixiContainer;
  particlesAdd: PixiContainer;
  /** A `BitmapText` of "0" in `WarmState.textFont`; made at its first draw. */
  text: PixiContainer | undefined;
};

/**
 * The pipeline warm-up (F4): the queue of probe draws, the filters handed over and the promises waiting on them, the
 * text probe's font, the probe tree, and the listeners of the end of a run. Not public.
 */
export type WarmState = {
  /** The draws not yet drawn, from `head` on; emptied when the head reaches the end. */
  queue: WarmDraw[];
  head: number;
  /** Every filter handed over on any device: queued again after a restore. */
  filters: Set<PixiFilter>;
  /** The filters whose draws are not all made yet: the draws left, and the promises to answer. */
  waiting: Map<PixiFilter, { left: number; resolve: Array<(warmed: boolean) => void> }>;
  /** The text probe is queued for this device. */
  textQueued: boolean;
  /** The font key of the text probe: the first font installed. */
  textFont: string | undefined;
  objects: WarmObjects | undefined;
  /** The draws made since the queue last started, for the `warm` event line. */
  draws: number;
  /**
   * A probe's render threw on this application: Pixi's filter stack may be unbalanced, so no probe is drawn again until
   * a new application starts the warm-up.
   */
  failed: boolean;
  /** The warnings logged once: `"probes"` (a tree Pixi could not build) and `"canvas-off"`. */
  reported: Set<unknown>;
  listeners: WarmListener[];
};

/**
 * Where the overlay step's event lines go: the monitor's `event`. Private to the renderer.
 */
export type OverlayEventSink = {
  event(name: PerfEventName, detail: Readonly<OverlayEventDetail>): void;
};

/**
 * Where an overlay is in its life: coming in, landed (its enter motion is over), or leaving.
 *
 * @example
 * ```ts
 * const phase: OverlayPhase = "shown";
 * ```
 */
export type OverlayPhase = "entering" | "shown" | "exiting";

/**
 * What an overlay does to what is drawn before it this frame: `"cover"` draws none of it (an opaque overlay, landed
 * at alpha 1), `"freeze"` draws it as one kept picture, `"live"` draws it as it is (an opaque overlay leaving, an
 * overlay inside another one's picture, a range drawn live).
 *
 * @example
 * ```ts
 * const mode: OverlayMode = "freeze";
 * ```
 */
export type OverlayMode = "cover" | "freeze" | "live";

/**
 * One overlay as `debug.overlays()` reports it: the marked entity and its view's label, its phase, its mode, its level
 * (0 to 1), how many entries the range it owns has (0 for an overlay that owns none), and whether a picture holds them.
 *
 * @example
 * ```ts
 * const report: OverlayReport = {
 *   entity: 1_048_601, label: "Shape#1048601 shop.dim:shopDimLayer", phase: "shown", mode: "freeze", level: 1, range: 2, kept: true
 * };
 * ```
 */
export type OverlayReport = {
  entity: Entity;
  label: string;
  phase: OverlayPhase;
  mode: OverlayMode;
  level: number;
  range: number;
  kept: boolean;
};

/**
 * One overlay the step knows: the marked element, the root it hangs from and where that root is drawn, the clamped
 * marker, its level, phase and mode, and its dim. Private to the renderer.
 */
export type OverlayRecord = {
  readonly entity: Entity;
  /** The label of the marked view's object, kept for the line of the frame it is gone in. */
  label: string;
  /** The end of its `Parent` chain: the root that hangs in a layer container. */
  top: Entity;
  /** That root's top object (`wrapper ?? object`). */
  object: PixiContainer;
  /** The layer container the root hangs in. */
  container: PixiContainer;
  layer: string;
  /** Index in the scene's layer list. */
  layerIndex: number;
  /** The marker, clamped (O1); the record's own object, written in place. */
  readonly value: OverlayValue;
  /** The engine's level of the overlay, 0 to 1. */
  level: number;
  phase: OverlayPhase;
  /** The phase it turned to this frame: `"shown"` at landing, `"exiting"` at the first exit frame. */
  turned: OverlayPhase | undefined;
  mode: OverlayMode;
  /** The engine's dim, made when `dim` is above 0. */
  dim: PixiSprite | undefined;
  /** The dim was sized for the canvas at least once. */
  sized: boolean;
  /** Seen by the step this frame; a record not seen is dropped. */
  seen: boolean;
  /** The event to log once the step has decided the modes: `"open"`, `"landed"` or `"leave"`. */
  news: OverlayEventDetail["what"] | undefined;
};

/**
 * The one range an overlay keeps or covers: its owner, the reason written on its entries, the entries and the nodes
 * its picture hides, and the counters of the retake rules. Private to the renderer.
 */
export type ActiveRange = {
  owner: Entity;
  mode: "cover" | "freeze";
  /** The reason on the entries now: `"cover"`, `"freeze"`, or none while the range is drawn live. */
  reason: HiddenReason | undefined;
  /** Bottom first: lower layer containers, then roots and engine objects of the owner's layer. */
  readonly entries: PixiContainer[];
  /** What the range picture hides for its render: layers above, the owner and above. */
  readonly others: PixiContainer[];
  /** The entries, for the membership walk. */
  set: Set<PixiContainer>;
  /** The node the picture stands before: the owner's dim, or its root. */
  before: PixiContainer | undefined;
  /** A picture holds the range (freeze only). */
  kept: boolean;
  /** The last take was refused; tried again when the owner or the entries change. */
  refused: boolean;
  /**
   * An entry, or a view inside the range that covers the viewport frame, holds a blurring filter (O9.2): measured at
   * every take and retake, and in every frame the fallback draws the range live.
   */
  blurred: boolean;
  /** A loop write was held back since the last take. */
  touched: boolean;
  /** The held loops write once in the next frame, and the picture is taken again with them (landing, first exit frame). */
  catchUp: boolean;
  /** The others changed since the last hand-over: the next retake hands the lists over again. */
  othersStale: boolean;
  /** Frames in a row retaken for a mark (O8.4). */
  streak: number;
  /** Frames in a row with no mark in the range, while the fallback is live. */
  calm: number;
  /** Drawn live because it changed in every frame. */
  fallback: boolean;
};

/**
 * The overlay step's state, `ctx.state.sync.overlay`. Collections and arrays are reused: a frame allocates nothing.
 * Private to the renderer.
 */
export type OverlayState = {
  /** Entities with `Overlay`, from `onAdded` / `onRemoved`. */
  entities: Set<Entity>;
  /** Entities with `HudPart`, from `onAdded` / `onRemoved`. */
  parts: Set<Entity>;
  records: Map<Entity, OverlayRecord>;
  /** The records bottom first, reused. */
  order: OverlayRecord[];
  /** The range of the owner, or `undefined` with none. */
  active: ActiveRange | undefined;
  /** The range object, made once and reused. */
  range: ActiveRange | undefined;
  /** Top objects of the HUD parts that take no tap. */
  offTops: Set<PixiContainer>;
  /** `"<code>:<entity>"` of the warnings logged once. */
  warned: Set<string>;
  /** The `overlay` event lines of an agent build, until the frame hands them to the monitor. */
  events: OverlayEventDetail[];
  /** Scratch: the entries and others wanted this frame, and the set of the entries. */
  wantEntries: PixiContainer[];
  wantOthers: PixiContainer[];
  wantSet: Set<PixiContainer>;
  /** Entities whose reason the step itself flipped this frame: their marks are no change of the range's pixels. */
  flipped: Set<Entity>;
  /** Scratch of the tap set. */
  nextOff: Set<PixiContainer>;
  /** A view left its place in the held range since the last step (it moved, or its view went). */
  left: boolean;
  /** Scratch of the cover test of `blurred`: made on first use from the Pixi module the renderer loaded. */
  bounds: PixiBounds | undefined;
};

/**
 * The display objects `sync` holds: views of entities and pooled objects.
 */
export type SyncCounts = { views: number; pooled: number };

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
  /** The components a plugin above draws its own way, in registration order. */
  adapters: DisplayEntry[];
  /** The bitmap fonts installed in this application, by asset key. */
  fonts: Map<string, PixiBitmapFont>;
  /** The global Pixi cache the fonts were registered in, so `onStop` can take them out again. */
  fontCache: PixiModule["Cache"] | undefined;
  /** Texture key to the entities that use it, for `invalidate`. */
  byKey: Map<string, Set<Entity>>;
  /** The crops of `"cover"` sprites, by `key@widthxheight`. */
  frames: Map<string, CoverFrame>;
  /**
   * The textures `textures.slice` cut, whose source belongs to a page. Kept past `onStop`, so
   * `assets` releasing its slices later still frees only the wrappers.
   */
  slices: WeakSet<PixiTexture>;
  invalidated: Set<string>;
  /** Keys already reported missing, so one key warns once. */
  warned: Set<string>;
  added: Set<Entity>;
  removed: Set<Entity>;
  /** Entities whose `Parent` was removed: `world` marks no change then, only `onRemoved` fires. */
  reparented: Set<Entity>;
  /**
   * Views whose `Parent` has no view yet: detached, drawn nowhere, attached at the end of the pass that builds the
   * parent's view (spec 16 U2.4).
   */
  orphans: Set<Entity>;
  /** Entities the tree check of a dev or agent build already reported, so each is reported once (spec 16 U2.5). */
  mismatched: Set<Entity>;
  /**
   * The nine-slice and overdraw switches, from `config.debug` and `debug.nineSlice` / `debug.overdraw`; the pixel check
   * lives in `demand`, the kept switch in `kept`.
   */
  debug: { nineSlice: boolean; overdraw: boolean };
  /** The restore table of the overdraw stage pass, its matrix and the listeners of the switch. */
  overdraw: OverdrawState;
  /** The nine-slice switch moved: the next pass writes every nine-slice again. */
  outlinesStale: boolean;
  /** The filters `effects` set per entity, kept while the entity lives, view or not. */
  filters: Map<Entity, readonly FilterSlot[]>;
  /** The filter area `effects` set per entity, kept like its filters (B4). */
  areas: Map<Entity, AreaEntry>;
  /**
   * True while a filter or area entry may belong to an entity without a view: the pass then forgets the entries of the
   * despawned ones, and stays on while a live entity without a view holds one. False when every entry belongs to a
   * view, so a still frame walks no entry.
   */
  viewlessEntries: boolean;
  /** The pipeline warm-up (F4). */
  warm: WarmState;
  /**
   * The kind of each Pixi filter a slot named, for the performance log of an agent build; a
   * blur's two passes are filters of their own and are in it too. Empty in a production build.
   */
  filterKinds: WeakMap<object, string>;
  /**
   * The entity each Pixi filter a slot hangs on (its stages and a blur's pass filters too), for the passes of the
   * performance log; the slot set last wins. Empty in a production build.
   */
  filterOwners: WeakMap<object, Entity>;
  /** Hidden masks of engine objects that are no view (an overlay's dim, a kept quad). */
  objectHidden: WeakMap<PixiContainer, number>;
  /** The view whose top (`wrapper ?? object`) a node is, for the hidden masks (O15; skeleton choice, confirmed in LEAD-FIXES-3). */
  viewOfTop: WeakMap<PixiContainer, View>;
  /** The overlays, their ranges, dims and HUD parts (spec 22). */
  overlay: OverlayState;
  /** `Graphics` paths drawn since the monitor last took them: shapes, clip masks, outlines (spec 26 R2.3). */
  redraws: number;
  /**
   * Where the walk of `shown` stopped for the entities whose loops asked since the last sync pass (spec 26 R1.7.3):
   * an entity with several endless loops is walked once a frame. Cleared by every pass, which may change the tree.
   */
  held: Map<Entity, Unseen>;
  cleanups: Array<() => void>;
};

/**
 * The overdraw heat map's state: the restore table of one stage pass (a node, its alpha, its blend mode, its filters
 * or `undefined` for none), the root's own filters, the matrix made once, and who hears a move of the switch.
 */
export type OverdrawState = {
  nodes: PixiContainer[];
  alphas: number[];
  blends: Array<PixiContainer["blendMode"]>;
  filters: Array<readonly PixiFilter[] | undefined>;
  rootFilters: readonly PixiFilter[] | undefined;
  matrix: PixiFilter | undefined;
  listeners: Array<(on: boolean) => void>;
};

/**
 * What `sync` gets injected: the two modules below it, `demand`, which every write site marks before it writes, and
 * `kept`, which says where a view's filters hang and keeps its picture.
 */
export type SyncDeps = {
  host: HostApi & HostInternal;
  viewport: ViewportApi & ViewportInternal;
  demand: DemandModule;
  kept: KeptModule;
};

/**
 * Domain context of the sync module.
 */
export type SyncCtx = { ctx: RendererCtx; deps: SyncDeps };

export type { HiddenCtx, HiddenReason } from "./hidden";

/**
 * The writers of `sync` the kept cache draws through, injected by `createModules`, since a module never imports
 * another's run-time code: the one owner of `renderable` (`hidden.ts`) and the one writer of a view's filters.
 */
export type SyncWriters = {
  /** Changes one reason of a view and its `renderable` without a mark. */
  readonly swapHidden: (sctx: HiddenCtx, view: View, reason: HiddenReason, hidden: boolean) => void;
  /** Tells whether one reason hides a view. */
  readonly hiddenBy: (view: View, reason: HiddenReason) => boolean;
  /** Tells whether a node is hidden by these reasons alone. */
  readonly hiddenOnlyAmong: (
    sctx: HiddenCtx,
    node: PixiContainer,
    reasons: readonly HiddenReason[]
  ) => boolean;
  /** Draws a picture of nodes hidden only by one reason, every node back from its mask after. */
  readonly liftFor: <Result>(
    sctx: HiddenCtx,
    lift: readonly PixiContainer[],
    hide: readonly PixiContainer[],
    reason: HiddenReason,
    draw: () => Result
  ) => Result;
  /** Hangs the filters on a view's top, or on a target. */
  readonly applyFilters: (
    view: View,
    slots: readonly FilterSlot[],
    before: () => void,
    target?: PixiContainer
  ) => void;
  /** Takes every filter off a display object. */
  readonly clearFilters: (target: PixiContainer) => void;
  /** The render passes of the frame as the tree stands now, read from the filter slots (the estimate). */
  readonly renderPassesOf: (state: SyncState, kept: KeptState) => number;
};
