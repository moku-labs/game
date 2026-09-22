/**
 * @file assets plugin — shared types: the manifest contract, the I/O seam, the authoring helpers
 * and the public API. Nothing here imports `pixi.js`: the texture type comes from `renderer`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Descriptor, Api as FlowApi, NodeInfo } from "../flow/types";
import type { PixiTexture, Api as RendererApi } from "../renderer/types";

/**
 * When a bundle is loaded. `boot` and `core` stay for the whole session, `scene` and `feature`
 * come and go with the graph, `lazy` is never preloaded.
 *
 * @example
 * ```ts
 * const tier: Tier = "scene";
 * ```
 */
export type Tier = "boot" | "core" | "scene" | "feature" | "lazy";

/**
 * A GPU texture. `assets` owns its lifetime and never imports Pixi: `renderer` makes and destroys
 * it, this plugin only says when.
 */
export type Texture = PixiTexture;

/**
 * A decoded image, ready for the upload. `createImageBitmap` produces the first shape.
 */
export type DecodedImage = ImageBitmap | HTMLImageElement;

/**
 * Nine-slice borders in pixels, in the order left, top, right, bottom.
 *
 * @example
 * ```ts
 * const borders: NineBorders = [48, 48, 48, 48];
 * ```
 */
export type NineBorders = readonly [number, number, number, number];

/**
 * Options of `io.createTexture`. Same shape as `renderer.sync.textures.create`.
 *
 * @example
 * ```ts
 * const options: CreateTextureOptions = { nine: [48, 48, 48, 48] };
 * ```
 */
export type CreateTextureOptions = { nine?: NineBorders };

/**
 * The part of a fetch response the plugin reads. The global `Response` fits it.
 */
export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
};

/**
 * The I/O seam: everything that leaves the plugin. `undefined` in the config means the browser
 * pair plus `renderer.sync.textures`; a test passes a fake and nothing touches the network or a GPU.
 *
 * @example
 * ```ts
 * // A unit test serves two files from memory and counts the textures it handed out.
 * const io: AssetsIo = {
 *   fetch: async () => ({ ok: true, status: 200, json: async () => ({}), blob: async () => blob }),
 *   decode: async () => bitmap,
 *   createTexture: () => ({ id: "t1" }) as unknown as Texture,
 *   destroyTexture: texture => destroyed.push(texture)
 * };
 *
 * createApp({ plugins: [...screen], pluginConfigs: { assets: { io, manifest } } });
 * ```
 */
export type AssetsIo = {
  /**
   * Fetches one URL: the manifest, or a file of a bundle.
   *
   * @param url - Absolute or root-relative URL.
   * @param init - Carries the abort signal of the running load.
   * @param init.signal - Aborts the request when the load is cancelled.
   * @returns The response.
   */
  fetch(url: string, init: { signal: AbortSignal }): Promise<FetchResponse>;

  /**
   * Decodes one image file.
   *
   * @param blob - The bytes of the file.
   * @returns The decoded image.
   */
  decode(blob: Blob): Promise<DecodedImage>;

  /**
   * Uploads one decoded image to the GPU.
   *
   * @param image - The decoded image.
   * @param options - `nine` becomes the default nine-slice borders of the texture.
   * @returns The new texture.
   */
  createTexture(image: DecodedImage, options?: CreateTextureOptions): Texture;

  /**
   * Frees one texture and its source.
   *
   * @param texture - The texture to free.
   */
  destroyTexture(texture: Texture): void;
};

/**
 * Nine-slice metadata of one file, as the scanner writes it. Always four numbers, so a later
 * four-value tag needs no format change.
 *
 * @example
 * ```ts
 * const nine: NineSlice = { left: 48, top: 48, right: 48, bottom: 48 };
 * ```
 */
export type NineSlice = { left: number; top: number; right: number; bottom: number };

/**
 * Reserved atlas placement. V2 never writes it and refuses to load a file that carries it.
 *
 * @example
 * ```ts
 * const frame: AtlasFrame = { page: "ui-0.png", x: 0, y: 0, width: 128, height: 128 };
 * ```
 */
export type AtlasFrame = { page: string; x: number; y: number; width: number; height: number };

/**
 * One file of a bundle. `mb` is the estimated texture memory, `width × height × 4` bytes.
 *
 * @example
 * ```ts
 * const file: ManifestFile = {
 *   key: "ui.panel",
 *   path: "features/ui/assets/panel{nine=48}.png",
 *   width: 256,
 *   height: 128,
 *   mb: 0.125,
 *   nine: { left: 48, top: 48, right: 48, bottom: 48 }
 * };
 * ```
 */
export type ManifestFile = {
  key: string;
  path: string;
  width: number;
  height: number;
  mb: number;
  nine?: NineSlice;
  atlas?: AtlasFrame;
};

/**
 * One bundle of the manifest: which feature owns it, when it loads and what it costs.
 *
 * @example
 * ```ts
 * const bundle: ManifestBundle = { feature: "ui", tier: "core", mb: 0.125, files: [] };
 * ```
 */
export type ManifestBundle = {
  feature: string;
  tier: Tier;
  mb: number;
  files: readonly ManifestFile[];
};

/**
 * The manifest: the contract between the scanner, this plugin and the editor later. Bundles are
 * sorted by name and files by key, so two scans of the same tree give the same bytes.
 *
 * @example
 * ```ts
 * const manifest: Manifest = {
 *   version: 1,
 *   bundles: { ui: { feature: "ui", tier: "core", mb: 0, files: [] } }
 * };
 *
 * createApp({ plugins: [...screen], pluginConfigs: { assets: { manifest } } });
 * ```
 */
export type Manifest = { version: 1; bundles: Readonly<Record<string, ManifestBundle>> };

/**
 * What a feature declares about one of its bundles. `files` are globs relative to the feature's
 * `assets/`; a bundle with `files` takes those files out of the feature's default bundle.
 *
 * @example
 * ```ts
 * const spec: BundleSpec = { tier: "lazy", files: ["chains/*.png"] };
 * ```
 */
export type BundleSpec = { tier: Tier; files?: readonly string[] };

/**
 * What `defineBundles` returns: plain data the scanner and the plugin both read.
 *
 * @example
 * ```ts
 * const bundles: BundleMap = {
 *   kind: "bundles",
 *   map: { board: { tier: "scene" }, "board.chains": { tier: "lazy", files: ["chains/*.png"] } }
 * };
 * ```
 */
export type BundleMap<Key extends string = string> = {
  kind: "bundles";
  map: Partial<Record<Key, BundleSpec>>;
};

/**
 * `defineBundles` bound to the bundle keys of one game. `defineGame` returns it, so a key that is
 * not in `BundleKey` does not compile.
 *
 * @example
 * ```ts
 * const defineGameBundles: DefineBundles<"board" | "board.chains"> = defineBundles;
 * ```
 */
export type DefineBundles<Key extends string> = (
  map: Partial<Record<Key, BundleSpec>>
) => BundleMap<Key>;

/**
 * The `load` descriptor helper bound to the bundle keys of one game.
 *
 * @example
 * ```ts
 * const loadGameBundle: LoadBundles<"board" | "board.chains"> = load;
 * ```
 */
export type LoadBundles<Key extends string> = (bundle: Key | readonly Key[]) => Descriptor;

/**
 * What the `load` effect resolves with, so a loading node can write its own progress.
 *
 * @example
 * ```ts
 * const result: LoadResult = { loaded: ["board.chains"], mb: 1.25 };
 * ```
 */
export type LoadResult = { loaded: string[]; mb: number };

/**
 * Why a bundle was loaded. It is the reason of the caller that started the load; a later waiter
 * changes nothing.
 *
 * @example
 * ```ts
 * const reason: LoadReason = "enter";
 * ```
 */
export type LoadReason = "boot" | "enter" | "request" | "preload";

/**
 * The running load of one bundle. Every caller is a waiter; the last one to leave aborts it.
 * `promise` never rejects: what broke waits in `error`, so a load nobody joined any more cannot
 * become an unhandled rejection.
 */
export type Inflight = {
  promise: Promise<void>;
  controller: AbortController;
  waiters: number;
  error: unknown;
};

/**
 * What the plugin knows about one bundle. `lastUsed` is the value of `useCounter` at the last
 * touch: a counter, never a clock.
 */
export type BundleRecord = {
  status: "idle" | "loading" | "loaded";
  textures: Map<string, Texture>;
  inflight: Inflight | undefined;
  lastUsed: number;
};

/**
 * The background preload. A new rest node replaces it and aborts the old controller.
 */
export type PreloadQueue = { bundles: string[]; controller: AbortController };

/**
 * assets plugin config.
 *
 * @example
 * ```ts
 * createApp({
 *   plugins: [...screen, boardFeature],
 *   pluginConfigs: { assets: { manifest: "/assets/manifest.json", textureBudgetMb: 192 } }
 * });
 * ```
 */
export type Config = {
  /** URL of `manifest.json`, or the parsed manifest itself (tests, headless). `undefined`: an empty manifest. */
  manifest: string | Manifest | undefined;
  /** Texture memory budget in MB. */
  textureBudgetMb: number;
  /** How many edges from a rest node the background preload looks ahead. `0` turns preload off. */
  preloadDepth: number;
  /** Prefix of every file URL. The CDN seam. `undefined`: the folder of the manifest URL, or `"/"`. */
  baseUrl: string | undefined;
  /** I/O seam. `undefined`: the browser pair plus `renderer.sync.textures`, or headless. */
  io: AssetsIo | undefined;
};

/**
 * assets plugin state.
 */
export type State = {
  /** `undefined` means headless: manifest only, no fetches, no textures. */
  io: AssetsIo | undefined;
  /** Empty until `onStart` read it. */
  manifest: Manifest;
  /** Asset key to the bundle that carries it. */
  bundleOfKey: Map<string, string>;
  /** Scene id to its bundle, read from the `scenes` key of `flow.features`. */
  bundleOfScene: Map<string, string>;
  /** Flow id to the feature that owns it, read from the `flows` key of `flow.features`. */
  featureOfFlow: Map<string, string>;
  records: Map<string, BundleRecord>;
  /** Bundles of the node entered last. They are never unloaded. */
  pinned: Set<string>;
  /** The bundle of the scene entered last. A node without `scene` keeps it. */
  sceneBundle: string | undefined;
  queue: PreloadQueue | undefined;
  current: NodeInfo | undefined;
  useCounter: number;
  /** Keys already reported missing, so one key warns and starts its background load once. */
  warned: Set<string>;
  /** `onEnter`, the `load` handler and the texture provider. */
  removers: Array<() => void>;
};

/**
 * What `usage()` reports about one loaded bundle.
 *
 * @example
 * ```ts
 * const entry: BundleUsage = { name: "board", tier: "scene", mb: 3.5, lastUsed: 12 };
 * ```
 */
export type BundleUsage = { name: string; tier: Tier; mb: number; lastUsed: number };

/**
 * What `usage()` reports: the numbers a dev overlay and the tests read.
 *
 * @example
 * ```ts
 * const report: Usage = { textureMb: 3.5, budgetMb: 192, bundles: [] };
 * ```
 */
export type Usage = { textureMb: number; budgetMb: number; bundles: readonly BundleUsage[] };

/**
 * assets plugin events.
 *
 * @example
 * ```ts
 * // A game reports every loaded bundle to its analytics.
 * createPlugin("loadReport", {
 *   depends: [assetsPlugin],
 *   hooks: ctx => ({ "assets:bundle-loaded": ({ bundle, mb }) => ctx.log.info("loaded", { bundle, mb }) })
 * }); // the board bundle logs { bundle: "board", mb: 3.5 }
 * ```
 */
export type Events = {
  /** Every file of a bundle is a texture now. */
  "assets:bundle-loaded": { bundle: string; tier: Tier; mb: number; reason: LoadReason };
  /** The textures of a bundle were destroyed. */
  "assets:bundle-unloaded": {
    bundle: string;
    tier: Tier;
    mb: number;
    reason: "budget" | "request";
  };
};

/**
 * How the load site sends its event. The one narrowing of `tiers.ts`.
 *
 * @example
 * ```ts
 * const emit: EmitLoaded = (name, payload) => bus.send(name, payload);
 * emit("assets:bundle-loaded", { bundle: "board", tier: "scene", mb: 3.5, reason: "enter" });
 * ```
 */
export type EmitLoaded = (
  name: "assets:bundle-loaded",
  payload: Events["assets:bundle-loaded"]
) => void;

/**
 * How the unload site sends its event. The one narrowing of `budget.ts`.
 *
 * @example
 * ```ts
 * const emit: EmitUnloaded = (name, payload) => bus.send(name, payload);
 * emit("assets:bundle-unloaded", { bundle: "board", tier: "scene", mb: 3.5, reason: "budget" });
 * ```
 */
export type EmitUnloaded = (
  name: "assets:bundle-unloaded",
  payload: Events["assets:bundle-unloaded"]
) => void;

/**
 * assets plugin API, `app.assets`. Bundles of textures by key: the graph decides when they arrive,
 * the budget decides when they leave.
 *
 * @example
 * ```ts
 * // A loading node asks for a bundle and a game system asks for one texture of it.
 * await app.assets.load("board");
 * app.assets.texture("board.cell"); // the Pixi texture, once the bundle is there
 * ```
 */
export type Api = {
  /**
   * Loads every file of a bundle. An already loaded bundle resolves at once, a loading one joins
   * the running load. Headless it resolves at once and touches nothing.
   *
   * @param bundle - Name of a bundle of the manifest.
   * @returns A promise that resolves when every texture of the bundle exists.
   * @throws {Error} When the manifest has no such bundle, and when a file fails to load.
   * @example
   * ```ts
   * // A game plugin warms the bundle of a timed event before its popup can open.
   * await app.assets.load("event.halloween");
   * app.assets.isLoaded("event.halloween"); // true
   * ```
   */
  load(bundle: string): Promise<void>;

  /**
   * Destroys the textures of a bundle and tells `renderer` that its keys are gone. A pinned
   * bundle and the tiers `boot` and `core` are refused with a warning. A running load is aborted.
   *
   * @param bundle - Name of a loaded bundle.
   * @example
   * ```ts
   * // The timed event ended: its textures go back to the GPU.
   * app.assets.unload("event.halloween");
   * app.assets.isLoaded("event.halloween"); // false
   * ```
   */
  unload(bundle: string): void;

  /**
   * Tells whether every texture of a bundle exists. Headless every bundle of the manifest counts
   * as loaded, so a headless game never waits for a loading screen.
   *
   * @param bundle - Name of a bundle of the manifest.
   * @returns True when the bundle is loaded.
   * @example
   * ```ts
   * // `scenes` skips its loading path when the bundle of the next scene is already there.
   * if (!app.assets.isLoaded("board")) await app.assets.load("board");
   * ```
   */
  isLoaded(bundle: string): boolean;

  /**
   * The texture of a loaded asset key. It touches the use counter of the bundle, which is what
   * the LRU reads. A key of a bundle that is not loaded warns once, starts a background load and
   * answers `undefined`; the sprites waiting for it are textured when that load lands.
   *
   * @param key - Asset key, as `generated/assets.ts` types it.
   * @returns The texture, or `undefined` while the bundle is not loaded.
   * @example
   * ```ts
   * // A game system builds one Pixi object by hand instead of using the Sprite component.
   * const texture = app.assets.texture("board.cell"); // undefined until the board bundle lands
   * ```
   */
  texture(key: string): Texture | undefined;

  /**
   * What the loaded bundles cost, sorted by name. `lastUsed` is the use counter, not a clock.
   *
   * @returns The used and allowed megabytes and one entry per loaded bundle.
   * @example
   * ```ts
   * // A dev overlay draws the memory bar of the game.
   * const { textureMb, budgetMb, bundles } = app.assets.usage();
   * // textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 }]
   * ```
   */
  usage(): Usage;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { flow: FlowApi; renderer: RendererApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: core 1.7 leaves a plugin's
 * own events out of the context it hands the factories as soon as `depends` is declared, so an
 * assets-typed `emit` here would make every factory unassignable. `tiers.ts` and `budget.ts`
 * narrow this one member; nothing else about the context is cast.
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(...args: never[]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the files of the plugin.
 */
export type AssetsCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the one event assets listens to.
 */
export type FlowRest = { path: string; checkpoint: boolean };
