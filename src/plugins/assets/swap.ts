/**
 * @file assets plugin — the dev hot swap of asset files. The keys watch of `moku-game dev` stamps
 * every asset file of the game into `.moku/assets-stamp.ts`; when that module changes, `ui`
 * forwards its new exports on the global `ui:hot-swap`. This file replaces the changed files of
 * the loaded bundles: a new texture, font or sound per key, the old textures destroyed after the
 * new ones are stored, then `assets:replaced`. A file that fails is logged and its bundle keeps
 * what it had. A changed set of files reloads the page instead: a hook cannot refuse by throwing,
 * the core bus catches what a hook throws.
 */
import { enforceBudget } from "./budget";
import { kindOf, nineOf, resolveBaseUrl, sumMb, textureMb } from "./manifest";
import { emptyAssets, type Loading, loadFont, loadImage, loadSound } from "./tiers";
import type {
  AssetStamps,
  AssetsCtx,
  AssetsIo,
  AudioAsset,
  BundleRecord,
  CreateTextureOptions,
  DecodedImage,
  HotSwap,
  LoadedFont,
  Manifest,
  ManifestBundle,
  ManifestFile,
  State,
  Texture
} from "./types";

/** The module the keys watch writes, as the hot footer reports its path. */
const STAMP_FILE = "/.moku/assets-stamp.ts";

/** The name of the folder of a feature or of a layer the scanner reads. */
const ASSETS = "assets";

/** That folder inside a path. */
const ASSETS_FOLDER = `/${ASSETS}/`;

/** What a refused or a broken swap calls: the page reload, or the spy of a test. */
type Reload = () => void;

/**
 * The file a manifest path leads to: its record, its own path and its bundle. The pages of a font
 * lead to the font, so the `.fnt` and every page share one owner.
 */
type Owner = { bundle: string; entry: ManifestBundle; file: ManifestFile; path: string };

/** The changed files of one bundle: what one `assets:replaced` reports. */
type Batch = { bundle: string; entry: ManifestBundle; owners: Owner[] };

/** The paths of one manifest: the owner of each, and the folders the scanner read them from. */
type PathIndex = { manifest: Manifest; owners: Map<string, Owner>; folders: readonly string[] };

/** The pixel size of a decoded image. */
type Size = { width: number; height: number };

/** A manifest record that carries a pixel size and what it costs: a texture file or a font page. */
type Sized = Size & { mb: number };

/** The pixel size of every texture a swap uploaded, by the texture. */
type Sizes = Map<Texture, Size>;

/** What one changed file brought, before it is stored. */
type Fresh =
  | { kind: "texture"; owner: Owner; texture: Texture }
  | { kind: "font"; owner: Owner; font: LoadedFont }
  | { kind: "audio"; owner: Owner; audio: AudioAsset };

/** A file that could not be replaced, as the log names it. */
type Failure = { path: string; reason: string };

/** One running swap: the context, the io the files come through and what a failure calls. */
type Swap = { ctx: AssetsCtx; io: AssetsIo; reload: Reload };

/**
 * Reloads the page. This is how a swap refuses, and what it does when a replace breaks after its
 * files arrived: the page boots again with the new manifest and the new files. Headless and in a
 * test there is no page, so nothing happens.
 */
function reloadPage(): void {
  globalThis.location?.reload();
}

/**
 * Tells whether a value maps paths to stamps.
 *
 * @param value - The `files` member of a stamp module.
 * @returns True for a plain object whose values are all strings.
 * @example
 * ```ts
 * isStampMap({ "features/ui/assets/fx-spark.webp": "2554:1791536552578" }); // true
 * ```
 */
function isStampMap(value: unknown): value is AssetStamps["files"] {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(stamp => typeof stamp === "string")
  );
}

/**
 * Tells whether a value is a list of paths.
 *
 * @param value - The `changed` member of a stamp module.
 * @returns True for an array of strings.
 * @example
 * ```ts
 * isPathList(["features/ui/assets/fx-spark.webp"]); // true
 * ```
 */
function isPathList(value: unknown): value is AssetStamps["changed"] {
  return Array.isArray(value) && value.every(path => typeof path === "string");
}

/**
 * Tells the stamp of the keys watch from any other default export.
 *
 * @param value - The default export of the stamp module.
 * @returns True when it carries a `files` map of strings and a `changed` list of strings.
 * @example
 * ```ts
 * isAssetStamps({ files: { "features/ui/assets/popup.mp3": "8120:1791536000000" }, changed: [] }); // true
 * isAssetStamps("3f2a9c"); // false: a hash, as the module carried before it listed the files
 * ```
 */
export function isAssetStamps(value: unknown): value is AssetStamps {
  if (typeof value !== "object" || value === null) return false;
  if (!("files" in value) || !("changed" in value)) return false;

  return isStampMap(value.files) && isPathList(value.changed);
}

/**
 * Reads the stamp out of a hot swap, when the saved module is the stamp of the keys watch.
 *
 * @param payload - The saved file and its new exports.
 * @returns The stamp, or `undefined` for any other file and for a module that carries none.
 * @example
 * ```ts
 * stampsOf({ file: "/game/features/hud/view.tsx", module: { Hud } }); // undefined
 * ```
 */
function stampsOf(payload: HotSwap): AssetStamps | undefined {
  if (!payload.file.replaceAll("\\", "/").endsWith(STAMP_FILE)) return undefined;

  const stamps = payload.module.default;

  return isAssetStamps(stamps) ? stamps : undefined;
}

/**
 * Reads the folder the scanner found a manifest path in. The scanner reads the `assets/` folder
 * of a feature or of a layer, so the path is cut after it; a path with no such folder, as in a
 * manifest written by hand, gives the folder of the file.
 *
 * @param path - A path of the manifest.
 * @returns The folder, ending in a slash, or `""` for a file at the root.
 * @example
 * ```ts
 * folderOf("features/ui/assets/fx/leaf.webp"); // "features/ui/assets/"
 * ```
 */
function folderOf(path: string): string {
  const scanned = path.indexOf(ASSETS_FOLDER);

  if (scanned !== -1) return path.slice(0, scanned + ASSETS_FOLDER.length);

  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Tells whether the scanner would read a path, by its shape alone. It mirrors `scanOwner` of
 * `scan/scan.ts`, which runtime code does not import: the scanner reads `<layer>/assets/` and
 * `<features>/<feature>/assets/` under the game root, so `assets` is the second or the third
 * segment and a file follows it. The page knows neither the layers nor the name of the features
 * folder, so any folder counts as one. This is what finds the first file of an `assets/` folder
 * the booted manifest names nowhere.
 *
 * @param path - A path of the game, root-relative with `/`.
 * @returns True for a path under the `assets/` of a layer or of a feature.
 * @example
 * ```ts
 * isScannerPath("features/shop/assets/coin.png"); // true: a feature
 * isScannerPath("shared/assets/button/primary.png"); // true: a layer
 * isScannerPath("features/home/outside.webp"); // false
 * ```
 */
function isScannerPath(path: string): boolean {
  const segments = path.split("/");
  const inLayer = segments[1] === ASSETS && segments.length > 2;
  const inFeature = segments[2] === ASSETS && segments.length > 3;

  return inLayer || inFeature;
}

/**
 * Builds the path index of a manifest: which file and bundle every path leads to, and the folders
 * the scanner read. A path under one of those folders that leads nowhere is a new asset.
 *
 * @param manifest - The manifest the page booted with.
 * @returns The index.
 */
function indexPaths(manifest: Manifest): PathIndex {
  const owners = new Map<string, Owner>();
  const folders = new Set<string>();

  for (const [bundle, entry] of Object.entries(manifest.bundles)) {
    for (const file of entry.files) {
      // A texture packed in an atlas has no path: it is cut out of a page, and a pack is not watched.
      if (file.path === undefined) continue;

      const owner: Owner = { bundle, entry, file, path: file.path };

      for (const path of [file.path, ...(file.pages ?? []).map(page => page.path)]) {
        owners.set(path, owner);
        folders.add(folderOf(path));
      }
    }
  }

  // A file at the root has no folder, and the empty prefix would claim every image of the game.
  folders.delete("");

  return { manifest, owners, folders: [...folders] };
}

/**
 * Works out which files a stamp changed, and keeps its map for the next one. Against the map
 * applied last it is every path whose stamp differs. The first update after boot has no map to
 * compare with, so the list of the keys watch stands.
 *
 * @param state - The plugin state.
 * @param stamps - The stamp that arrived.
 * @returns The changed paths.
 */
function changedPaths(state: State, stamps: AssetStamps): readonly string[] {
  const applied = state.stamps;

  state.stamps = stamps.files;

  if (applied === undefined) return stamps.changed;

  return Object.keys(stamps.files).filter(path => stamps.files[path] !== applied[path]);
}

/**
 * Tells why a stamp cannot be swapped in place: the set of files is not the one of the manifest
 * the page booted with. A manifest path the watch no longer stamps was removed or renamed, or its
 * nine-slice tag changed. A changed path the manifest does not know is a new asset when it lies
 * under a folder the manifest names, or where the scanner reads: the first file of an `assets/`
 * folder that had none counts too. The watch stamps every image of the game tree, so any other
 * unknown path (a favicon, an image of a feature outside its `assets/`) refuses nothing.
 *
 * @param index - The path index of the manifest.
 * @param stamps - The stamp that arrived.
 * @param changed - The paths whose bytes changed.
 * @returns The reason, or `undefined` when only bytes changed.
 */
function refusalOf(
  index: PathIndex,
  stamps: AssetStamps,
  changed: readonly string[]
): string | undefined {
  for (const path of index.owners.keys()) {
    if (!Object.hasOwn(stamps.files, path)) return `"${path}" left the game`;
  }

  for (const path of changed) {
    if (index.owners.has(path)) continue;

    const isNew = isScannerPath(path) || index.folders.some(folder => path.startsWith(folder));

    if (isNew) return `"${path}" is not in the manifest`;
  }

  return undefined;
}

/**
 * Groups the changed files by their bundle. A font whose `.fnt` and pages changed in one save is
 * listed once: a font is replaced as a whole. A path the manifest does not know is left out.
 *
 * @param index - The path index of the manifest.
 * @param changed - The paths whose bytes changed.
 * @returns One batch per bundle, in the order the paths name them.
 */
function batchesOf(index: PathIndex, changed: readonly string[]): Batch[] {
  const batches = new Map<string, Batch>();

  for (const path of changed) {
    const owner = index.owners.get(path);

    if (owner === undefined) continue;

    const { bundle, entry } = owner;
    const batch = batches.get(bundle) ?? { bundle, entry, owners: [] };

    if (!batch.owners.includes(owner)) batch.owners.push(owner);

    batches.set(bundle, batch);
  }

  return [...batches.values()];
}

/**
 * Copies the io of a swap so every texture it uploads is remembered with the pixel size of its
 * image. The manifest needs that size, and the loaders of `tiers.ts` answer the texture alone;
 * the list is also what a swap that does not land gives back. The io is a plain record of
 * functions, so the copy carries the other four members as they are.
 *
 * @param io - The I/O seam of the plugin.
 * @param sizes - Filled with every texture this io creates.
 * @returns The io with a measuring `createTexture`.
 */
function measuringIo(io: AssetsIo, sizes: Sizes): AssetsIo {
  return {
    ...io,
    createTexture: (image: DecodedImage, options?: CreateTextureOptions): Texture => {
      const texture = io.createTexture(image, options);

      sizes.set(texture, { width: image.width, height: image.height });

      return texture;
    }
  };
}

/**
 * Builds the running load the file loaders of `tiers.ts` take, for the files of one bundle.
 *
 * @param swap - The running swap.
 * @param bundle - Name of the bundle.
 * @param sizes - Filled with every texture the load creates.
 * @returns The running load.
 */
function loadingOf(swap: Swap, bundle: string, sizes: Sizes): Loading {
  const { config } = swap.ctx;

  return {
    io: measuringIo(swap.io, sizes),
    bundle,
    base: resolveBaseUrl(config.baseUrl, config.manifest),
    // Nothing cancels a swap: its files all settle, and a failed one is only logged.
    signal: new AbortController().signal,
    assets: emptyAssets()
  };
}

/**
 * Loads one changed file again, by what the manifest says it is. A font is read as a whole: its
 * `.fnt` and every page, whichever of them changed.
 *
 * @param run - The running load.
 * @param owner - The file to load.
 * @returns What the file brought.
 * @throws {Error} When a fetch or a decode fails, or the font lists no page.
 */
async function loadFresh(run: Loading, owner: Owner): Promise<Fresh> {
  const kind = kindOf(owner.file);

  if (kind === "font") return { kind, owner, font: await loadFont(run, owner.file) };
  if (kind === "audio") return { kind, owner, audio: await loadSound(run, owner.file) };

  return { kind, owner, texture: await loadImage(run, owner.path, nineOf(owner.file)) };
}

/**
 * Says why a file could not be replaced.
 *
 * @param error - What the load threw.
 * @returns The message of an error, or the value as a string.
 * @example
 * ```ts
 * reasonOf(new Error("The source image could not be decoded.")); // "The source image could not be decoded."
 * ```
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads every changed file of one bundle in parallel and waits for all of them, so nothing is
 * still on the way when the bundle is stored or given back.
 *
 * @param run - The running load.
 * @param owners - The files to load.
 * @returns What arrived, and the files that failed.
 */
async function loadAll(
  run: Loading,
  owners: readonly Owner[]
): Promise<{ fresh: Fresh[]; failures: Failure[] }> {
  const fresh: Fresh[] = [];
  const failures: Failure[] = [];

  await Promise.all(
    owners.map(owner =>
      loadFresh(run, owner).then(
        loaded => fresh.push(loaded),
        (error: unknown) => failures.push({ path: owner.path, reason: reasonOf(error) })
      )
    )
  );

  return { fresh, failures };
}

/**
 * Reads the record of a bundle once it stands still. A load that runs when the stamp arrives may
 * have fetched the old bytes, so it lands first.
 *
 * @param state - The plugin state.
 * @param bundle - Name of the bundle.
 * @returns The record when the bundle is loaded, else `undefined`: its next load reads the new
 *   bytes, the dev server answers every file with `no-store`.
 */
async function settledRecord(state: State, bundle: string): Promise<BundleRecord | undefined> {
  const record = state.records.get(bundle);

  if (record?.status === "loading") await record.inflight?.promise;

  return record?.status === "loaded" ? record : undefined;
}

/**
 * Writes the pixel size of a new image, and what it costs, into its manifest record.
 *
 * @param target - The record of a texture file or of a font page.
 * @param size - The size of the decoded image.
 */
function resize(target: Sized | undefined, size: Size | undefined): void {
  if (target === undefined || size === undefined) return;

  target.width = size.width;
  target.height = size.height;
  target.mb = textureMb(size.width, size.height);
}

/**
 * Stores a new font under its key and frees the pages of the old one. The record of each page and
 * of the font follow the new images.
 *
 * @param io - The I/O seam of the plugin.
 * @param record - The record of the loaded bundle.
 * @param owner - The font file.
 * @param font - The font that was read again.
 * @param sizes - The pixel size of every new page.
 */
function storeFont(
  io: AssetsIo,
  record: BundleRecord,
  owner: Owner,
  font: LoadedFont,
  sizes: Sizes
): void {
  const { file } = owner;
  const pages = file.pages ?? [];
  const old = record.fonts.get(file.key);

  record.fonts.set(file.key, font);

  for (const page of old?.pages ?? []) io.destroyTexture(page);

  for (const [at, texture] of font.pages.entries()) resize(pages[at], sizes.get(texture));

  file.mb = sumMb(pages);
}

/**
 * Stores what one changed file brought under its key. An old texture is destroyed only after the
 * new one is stored, so nothing ever answers a destroyed texture.
 *
 * @param io - The I/O seam of the plugin.
 * @param record - The record of the loaded bundle.
 * @param fresh - What the file brought.
 * @param sizes - The pixel size of every new texture.
 */
function store(io: AssetsIo, record: BundleRecord, fresh: Fresh, sizes: Sizes): void {
  const { file } = fresh.owner;

  if (fresh.kind === "font") {
    storeFont(io, record, fresh.owner, fresh.font, sizes);

    return;
  }

  if (fresh.kind === "audio") {
    record.audio.set(file.key, fresh.audio);

    return;
  }

  const old = record.textures.get(file.key);

  record.textures.set(file.key, fresh.texture);

  if (old !== undefined) io.destroyTexture(old);

  resize(file, sizes.get(fresh.texture));
}

/**
 * Makes the numbers and the picture follow the files that were stored: the megabytes of the
 * bundle, the budget, the views of the keys, the frame loop and the event.
 *
 * @param ctx - Domain context of the plugin.
 * @param batch - The bundle and its replaced files.
 * @param record - The record of the bundle.
 */
function publish(ctx: AssetsCtx, batch: Batch, record: BundleRecord): void {
  const { bundle, entry } = batch;
  const keys = batch.owners.map(owner => owner.file.key);

  entry.mb = sumMb([...entry.files, ...(entry.pages ?? [])]);
  enforceBudget(ctx);

  // The budget may have taken this very bundle: its unload told every holder already.
  if (record.status !== "loaded") return;

  ctx.deps.renderer.sync.textures.invalidate(keys);
  ctx.deps.time.wake();
  ctx.emit("assets:replaced", { bundle, keys });
}

/**
 * Replaces the changed files of one bundle. Every file is loaded first and nothing is stored
 * before all of them are there. A file that fails is logged and the bundle keeps its old
 * textures, fonts and bytes: the new textures are given back, nothing is emitted and the page
 * stays. The stamp of the broken file is applied all the same, so it is read again only when it
 * is saved again. A bundle that was unloaded on the way gives its new textures back too.
 *
 * @param swap - The running swap.
 * @param batch - The bundle and its changed files.
 * @throws {Error} What the io, the renderer or the budget throws after the files arrived.
 */
async function replaceBundle(swap: Swap, batch: Batch): Promise<void> {
  const { ctx, io } = swap;
  const record = await settledRecord(ctx.state, batch.bundle);

  if (record === undefined) return;

  const sizes: Sizes = new Map();
  const { fresh, failures } = await loadAll(loadingOf(swap, batch.bundle, sizes), batch.owners);

  if (failures.length > 0 || record.status !== "loaded") {
    for (const failure of failures) ctx.log.error("assets:replace-failed", failure);

    for (const texture of sizes.keys()) io.destroyTexture(texture);

    return;
  }

  for (const loaded of fresh) store(io, record, loaded, sizes);

  publish(ctx, batch, record);
}

/**
 * Runs one swap, bundle after bundle: a bundle with a file that failed does not stop the next
 * one. It never rejects, so the chain of swaps in the state cannot break. A throw after the files
 * arrived (from a destroy, the views or the budget) leaves a bundle whose stored state is not
 * known: every file of it is logged as failed, the page reloads and the swap stops there.
 *
 * @param swap - The running swap.
 * @param batches - The changed files, by bundle.
 */
async function replaceAll(swap: Swap, batches: readonly Batch[]): Promise<void> {
  for (const batch of batches) {
    try {
      await replaceBundle(swap, batch);
    } catch (error) {
      const reason = reasonOf(error);

      for (const { path } of batch.owners) {
        swap.ctx.log.error("assets:replace-failed", { path, reason });
      }

      swap.reload();

      return;
    }
  }
}

/**
 * Creates the handler of the dev hot swap of asset files. It acts only on the stamp of the keys
 * watch, and only with an io: a headless page has no file. What changed and whether the swap is
 * refused is decided at once; the replace itself waits for the swap before it, so two saves in a
 * row never overlap.
 *
 * @param ctx - Domain context of the plugin.
 * @param reload - What a refused or a broken swap calls. The page reload by default; a test
 *   passes a spy.
 * @returns The handler of `ui:hot-swap`.
 */
export function createSwap(
  ctx: AssetsCtx,
  reload: Reload = reloadPage
): (payload: HotSwap) => void {
  // Built on the first stamp, and again only if the manifest in the state is another one.
  let index: PathIndex | undefined;

  return (payload: HotSwap): void => {
    const { state } = ctx;
    const stamps = stampsOf(payload);
    const io = state.io;

    if (stamps === undefined || io === undefined) return;

    const changed = changedPaths(state, stamps);

    if (index?.manifest !== state.manifest) index = indexPaths(state.manifest);

    // A changed set of files reloads the page: the manifest it booted with is not true any more.
    const reason = refusalOf(index, stamps, changed);

    if (reason !== undefined) {
      ctx.log.info("assets:swap-refused", { reason });
      reload();

      return;
    }

    const batches = batchesOf(index, changed);

    if (batches.length === 0) return;

    // One swap at a time: this one starts when the one before it settled.
    const before = state.swapping ?? Promise.resolve();

    state.swapping = before.then(() => replaceAll({ ctx, io, reload }, batches));
  };
}
