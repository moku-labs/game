/**
 * @file assets plugin — shared types: the manifest contract, the I/O seam, the authoring helpers
 * and the public API. Nothing here imports `pixi.js`: the texture type comes from `renderer`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Events as GlobalEvents, Require } from "../../config";
import type { Descriptor, Api as FlowApi, NodeInfo } from "../flow/types";
import type { PixiTexture, Api as RendererApi, SliceFrame } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";

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
 * What one file of a bundle is. A `.fnt` with its `.png` pages is one `font`, an `.mp3` or an
 * `.m4a` is `audio`, everything else is a `texture`. A file of an older manifest that names no
 * kind is a texture.
 *
 * @example
 * ```ts
 * const kind: AssetKind = "font";
 * ```
 */
export type AssetKind = "texture" | "font" | "audio";

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
 * The part of a fetch response the plugin reads: the manifest is `json`, a texture is a `blob`,
 * a font file is `text` and an audio file stays the raw `arrayBuffer`. The global `Response`
 * fits it. `headers` gives the `content-type`: on `tauri://` a missing file comes back `200` with
 * `index.html`, so `text/html` for a path that is not `.html` counts as missing.
 */
export type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

/**
 * The I/O seam: everything that leaves the plugin. `undefined` in the config means the browser
 * pair plus `renderer.sync.textures`; a test passes a fake and nothing touches the network or a GPU.
 *
 * @example
 * ```ts
 * // A unit test serves two files from memory and counts the textures it handed out.
 * const io: AssetsIo = {
 *   fetch: async () => ({
 *     ok: true,
 *     status: 200,
 *     headers: { get: () => null },
 *     json: async () => ({}),
 *     blob: async () => blob,
 *     text: async () => 'info face="body"',
 *     arrayBuffer: async () => new ArrayBuffer(8)
 *   }),
 *   decode: async () => bitmap,
 *   createTexture: () => ({ id: "t1" }) as unknown as Texture,
 *   sliceTexture: (page, frame) => ({ id: "s1", page, frame }) as unknown as Texture,
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
   * Cuts the texture of one packed file out of its atlas page. The slice shares the page's
   * source: no pixel is copied. Same shape as `renderer.sync.textures.slice`; the manifest's
   * `atlas` frame is passed as it is.
   *
   * @param page - The page texture, made by `createTexture`.
   * @param frame - Where the file lies on the page, in page pixels.
   * @param options - `nine` becomes the default nine-slice borders of the slice.
   * @returns The new texture over the page's source.
   */
  sliceTexture(page: Texture, frame: SliceFrame, options?: CreateTextureOptions): Texture;

  /**
   * Frees one texture. A page frees its source too; a slice frees only itself, so the slices of
   * a bundle go first and its pages after them.
   *
   * @param texture - The texture to free.
   */
  destroyTexture(texture: Texture): void;
};

/**
 * Nine-slice metadata of one file, as the scanner writes it. Always four numbers: the tags
 * `{nine=N}`, `{nine=H,V}` and `{nine=L,T,R,B}` all land here.
 *
 * @example
 * ```ts
 * const nine: NineSlice = { left: 48, top: 48, right: 48, bottom: 48 };
 * ```
 */
export type NineSlice = { left: number; top: number; right: number; bottom: number };

/**
 * Where a packed file lies: `page` is the id of a page of the same bundle, never a file name, and
 * the frame is in page pixels. `width` and `height` equal the file's own, so its `nine` stays
 * valid as it is. The packer writes it; the loader cuts the file out of the page.
 *
 * @example
 * ```ts
 * const frame: AtlasFrame = { page: "ui/main-0", x: 583, y: 595, width: 256, height: 128 };
 * ```
 */
export type AtlasFrame = { page: string; x: number; y: number; width: number; height: number };

/**
 * One atlas page of a packed bundle. `id` is `<bundle>/<group>-<index>`, the name an `atlas`
 * frame uses; `path` is the hashed WebP file, read like the `path` of a file. `mb` is
 * `width × height × 4 / 1 048 576`: the page carries the cost of every file packed on it.
 *
 * @example
 * ```ts
 * const page: AtlasPage = {
 *   id: "ui/main-0",
 *   path: "ui/main-0-3b1d55a0c9.webp",
 *   width: 966,
 *   height: 1365,
 *   mb: 5.03
 * };
 * ```
 */
export type AtlasPage = { id: string; path: string; width: number; height: number; mb: number };

/**
 * One page image of a font. A page has no key of its own: it belongs to the `.fnt` file that
 * names it, and is loaded and freed with it.
 *
 * @example
 * ```ts
 * const page: FontPage = {
 *   path: "features/ui/assets/body_0.png",
 *   width: 256,
 *   height: 128,
 *   mb: 0.125
 * };
 * ```
 */
export type FontPage = { path: string; width: number; height: number; mb: number };

/**
 * One file of a bundle. `mb` is what it costs: `width × height × 4` bytes for a texture, the sum
 * of the pages for a font, the size of the file for audio, and `0` for a texture packed in an
 * atlas, whose page carries the cost. `kind` is absent for a texture, which is what every
 * manifest written before fonts and audio carries. A loose file has `path`; a packed texture has
 * `atlas` and no `path`.
 *
 * @example
 * ```ts
 * // The dev manifest of the scanner: a loose file.
 * const loose: ManifestFile = {
 *   key: "ui.panel",
 *   path: "features/ui/assets/panel{nine=48}.png",
 *   width: 256,
 *   height: 128,
 *   mb: 0.125,
 *   nine: { left: 48, top: 48, right: 48, bottom: 48 }
 * };
 *
 * // The packed manifest: the same key, cut out of the page "ui/main-0".
 * const packed: ManifestFile = {
 *   key: "ui.panel",
 *   width: 256,
 *   height: 128,
 *   mb: 0,
 *   nine: { left: 48, top: 48, right: 48, bottom: 48 },
 *   atlas: { page: "ui/main-0", x: 583, y: 595, width: 256, height: 128 }
 * };
 * ```
 */
export type ManifestFile = {
  key: string;
  path?: string;
  kind?: AssetKind;
  width: number;
  height: number;
  mb: number;
  pages?: readonly FontPage[];
  nine?: NineSlice;
  atlas?: AtlasFrame;
};

/**
 * One bundle of the manifest: which feature owns it, when it loads and what it costs. `pages` is
 * written by the packer only, sorted by id; `mb` is then its pages, its loose textures, its font
 * pages and its audio bytes together.
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
  pages?: readonly AtlasPage[];
  files: readonly ManifestFile[];
};

/**
 * The manifest: the contract between the scanner, the packer, this plugin and the editor. Version
 * `1` is the dev manifest of `bun run assets:keys`, version `2` the packed one of
 * `bun run assets:pack`; the plugin reads both. Bundles are sorted by name, pages by id and files
 * by key, so two runs on the same tree give the same bytes.
 *
 * @example
 * ```ts
 * // A dev build: loose files, straight from the features.
 * const manifest: Manifest = {
 *   version: 1,
 *   bundles: { ui: { feature: "ui", tier: "core", mb: 0, files: [] } }
 * };
 *
 * createApp({ plugins: [...screen], pluginConfigs: { assets: { manifest } } });
 *
 * // The packed manifest of the same game: the panel is cut out of the page "ui/main-0".
 * const page = { id: "ui/main-0", path: "ui/main-0-3b1d55a0c9.webp", width: 966, height: 1365, mb: 5.03 };
 * const atlas = { page: "ui/main-0", x: 583, y: 595, width: 256, height: 128 };
 * const panel = { key: "ui.panel", width: 256, height: 128, mb: 0, atlas };
 * const packed: Manifest = {
 *   version: 2,
 *   bundles: { ui: { feature: "ui", tier: "core", mb: 5.03, pages: [page], files: [panel] } }
 * };
 * ```
 */
export type Manifest = { version: 1 | 2; bundles: Readonly<Record<string, ManifestBundle>> };

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
 * A loaded font: the `.fnt` file as text and the page textures it names. `text` installs the
 * first page in the renderer; every page is destroyed with the bundle.
 *
 * @example
 * ```ts
 * const font: FontAsset = { fnt: 'info face="body" size=32', texture };
 * ```
 */
export type FontAsset = { fnt: string; texture: Texture };

/**
 * What the plugin keeps for a loaded font: the public pair plus every page, because a font of
 * two pages owns two textures.
 */
export type LoadedFont = FontAsset & { pages: readonly Texture[] };

/**
 * The container type of a sound, read from the extension of its file: `.mp3` is `"audio/mpeg"`,
 * `.m4a` (AAC in an MP4 container) is `"audio/mp4"`. These are the two formats the scanner takes,
 * and the two every browser and WebView decodes.
 *
 * @example
 * ```ts
 * const mime: AudioMime = "audio/mp4"; // the type of theme.m4a
 * ```
 */
export type AudioMime = "audio/mpeg" | "audio/mp4";

/**
 * A loaded sound: the bytes exactly as they were fetched, never decoded here, and the MIME type
 * of their container. A `Blob` of the bytes needs the type: Safari does not sniff a typeless one.
 *
 * @example
 * ```ts
 * const asset: AudioAsset = { bytes: new ArrayBuffer(12_288), mime: "audio/mpeg" }; // click.mp3
 * ```
 */
export type AudioAsset = { bytes: ArrayBuffer; mime: AudioMime };

/**
 * What one bundle brought: textures by asset key (a packed file's is a slice of its page), fonts
 * with their pages, the undecoded sounds with their MIME types, and the atlas pages by page id. A
 * running load fills the same four maps before they are published.
 */
export type LoadedAssets = {
  textures: Map<string, Texture>;
  fonts: Map<string, LoadedFont>;
  audio: Map<string, AudioAsset>;
  pages: Map<string, Texture>;
};

/**
 * What the plugin knows about one bundle. `lastUsed` is the value of `useCounter` at the last
 * touch: a counter, never a clock.
 */
export type BundleRecord = LoadedAssets & {
  status: "idle" | "loading" | "loaded";
  inflight: Inflight | undefined;
  lastUsed: number;
};

/**
 * The background preload. A new rest node replaces it and aborts the old controller.
 */
export type PreloadQueue = { bundles: string[]; controller: AbortController };

/**
 * What the keys watch of `moku-game dev` knows about the asset files of a game: the default export
 * of the generated `.moku/assets-stamp.ts`. The dev hot swap compares it with the map it applied
 * last and replaces the files whose stamp differs.
 *
 * @example
 * ```ts
 * // The stamp after a save of fx-spark.webp: every watched file, and the one that changed.
 * const stamps: AssetStamps = {
 *   files: {
 *     "features/ui/assets/font-body.fnt": "1810:1791536000000",
 *     "features/ui/assets/fx-spark.webp": "2554:1791536552578"
 *   },
 *   changed: ["features/ui/assets/fx-spark.webp"]
 * };
 * ```
 */
export type AssetStamps = {
  /** Every watched asset file, root-relative with `/`, and its `size:mtimeMs`. Sorted by path. */
  files: Readonly<Record<string, string>>;
  /** The files whose stamp differs from the batch before. Empty in the first stamp of a run. */
  changed: readonly string[];
};

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
  /** The `files` map of the stamp the dev hot swap applied last. `undefined` until the first swap. */
  stamps: Readonly<Record<string, string>> | undefined;
  /** The running dev hot swap. The next one waits for it, so two swaps never overlap. */
  swapping: Promise<void> | undefined;
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
 *
 * // A splash screen fills its loading bar file by file.
 * createPlugin("loadingBar", {
 *   depends: [assetsPlugin],
 *   createState: () => ({ share: 0 }),
 *   hooks: ctx => ({
 *     "assets:bundle-progress": ({ loaded, total }) => {
 *       ctx.state.share = loaded / total;
 *     }
 *   })
 * }); // a board bundle of four files sets share to 0.25, 0.5, 0.75 and 1; bundle-loaded follows
 *
 * // The audio plugin drops the buffer it decoded from a sound a dev save replaced.
 * hooks: ctx => ({
 *   "assets:replaced": ({ keys }) => {
 *     for (const key of keys) ctx.state.decoded.delete(key); // the next play decodes the new bytes
 *   }
 * }); // a save of features/ui/assets/click.mp3 sends { bundle: "ui", keys: ["ui.click"] }
 * ```
 */
export type Events = {
  /** Every file of a bundle is a texture now. */
  "assets:bundle-loaded": { bundle: string; tier: Tier; mb: number; reason: LoadReason };
  /**
   * One more file of a running load settled. `loaded` counts the settled files (a font once, with
   * its pages), `total` is the file count of the bundle; the last one of a load has
   * `loaded === total` and comes before `assets:bundle-loaded`. An aborted load sends none.
   */
  "assets:bundle-progress": { bundle: string; loaded: number; total: number };
  /** The textures of a bundle were destroyed. `keys` names every asset that went with it. */
  "assets:bundle-unloaded": {
    bundle: string;
    tier: Tier;
    mb: number;
    reason: "budget" | "request";
    keys: readonly string[];
  };
  /**
   * Files of a loaded bundle were replaced by a dev hot swap: one event per bundle per swap. `keys`
   * names every asset that has new bytes; each of them answers a new texture, font or sound, and
   * the old textures are destroyed. Dev builds only.
   */
  "assets:replaced": { bundle: string; keys: readonly string[] };
};

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
   * answers `undefined`; the sprites waiting for it are textured when that load lands. A key packed
   * in an atlas answers its slice of the page, so a game never sees the difference.
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
   * The font of a loaded asset key: the `.fnt` file as text and the texture of its first page.
   * It touches the use counter of the bundle. A font of a bundle that is not loaded, a key of
   * another kind and every headless run answer `undefined`.
   *
   * @param key - Asset key of a `.fnt` file, as `generated/assets.ts` types it in `FontKey`.
   * @returns The font, or `undefined` while its bundle is not loaded.
   * @example
   * ```ts
   * // `text` installs the font in the renderer when the bundle that carries it arrived.
   * const font = app.assets.font("ui.body"); // { fnt: 'info face="body" size=32', texture }
   *
   * if (font !== undefined) app.renderer.sync.fonts.install("ui.body", font.fnt, font.texture);
   * ```
   */
  font(key: string): FontAsset | undefined;

  /**
   * The sound of a loaded audio key: its bytes exactly as they were fetched (this plugin never
   * decodes them) and the MIME type of its container, `"audio/mpeg"` for an `.mp3` and
   * `"audio/mp4"` for an `.m4a`. A packed file keeps its extension, so it keeps its type. It
   * touches the use counter of the bundle. A bundle that is not loaded, a key of another kind and
   * every headless run answer `undefined`.
   *
   * @param key - Asset key of an `.mp3` or `.m4a` file, as `generated/assets.ts` types it in
   *   `AudioKey`.
   * @returns The bytes and their type, or `undefined` while its bundle is not loaded.
   * @example
   * ```ts
   * // The audio plugin decodes a sound, or streams a long track from a blob: URL of its bytes.
   * const asset = ctx.require(assetsPlugin).audio("ui.click");
   * // { bytes: ArrayBuffer(12 288), mime: "audio/mpeg" }
   * if (asset !== undefined) URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }));
   * ```
   */
  audio(key: string): AudioAsset | undefined;

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
export type Deps = { flow: FlowApi; renderer: RendererApi; time: TimeApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `index.ts` writes `events` with an annotated `register` (core spec `14-EVENT-REGISTRATION.md`
 * row 8), so the own events reach the context the kernel hands the factories and `emit` is the
 * kernel's own, assets-typed one. No member of the context is cast.
 */
export type KernelSlice = PluginCtx<Config, State, Events> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the files of the plugin.
 */
export type AssetsCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the `flow:rest` hook: where the graph rests.
 */
export type FlowRest = { path: string; checkpoint: boolean };

/**
 * Payload of the global `ui:hot-swap` hook: the saved file and its new exports. For the stamp of
 * the keys watch, `module.default` is the `AssetStamps`.
 */
export type HotSwap = GlobalEvents["ui:hot-swap"];
