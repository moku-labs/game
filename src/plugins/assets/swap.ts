/**
 * @file assets plugin — the dev hot swap of asset files. When the stamp of the keys watch changes
 * (`stamp.ts`), the changed files of the loaded bundles (`paths.ts`) are replaced here: a new
 * texture, font or sound per key, the old textures destroyed after the new ones are stored, then
 * `assets:replaced`. A file that fails is logged and its bundle keeps what it had. A changed set
 * of files reloads the page instead: a hook cannot refuse by throwing, the core bus catches what
 * a hook throws.
 */
import { enforceBudget } from "./budget";
import { kindOf, nineOf, resolveBaseUrl, sumMb, textureMb } from "./manifest";
import { type Batch, batchesOf, indexPaths, type Owner, type PathIndex, refusalOf } from "./paths";
import { changedPaths, stampsOf } from "./stamp";
import { emptyAssets, type Loading, loadFont, loadImage, loadSound } from "./tiers";
import type {
  AssetsCtx,
  AssetsIo,
  AudioAsset,
  BundleRecord,
  CreateTextureOptions,
  DecodedImage,
  HotSwap,
  LoadedFont,
  State,
  Texture
} from "./types";

// Twins of Reload, reloadPage and reasonOf live in text/display.ts: a change edits both.
/** What a refused or a broken swap calls: the page reload, or the spy of a test. */
type Reload = () => void;

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
 * Gives the new files of one bundle up: every file that failed is logged, and every texture the
 * swap uploaded goes back. Nothing was stored, so the bundle keeps what it had.
 *
 * @param swap - The running swap.
 * @param failures - The files that could not be read.
 * @param sizes - Every new texture of the bundle.
 */
function discard(swap: Swap, failures: readonly Failure[], sizes: Sizes): void {
  for (const failure of failures) swap.ctx.log.error("assets:replace-failed", failure);

  for (const texture of sizes.keys()) swap.io.destroyTexture(texture);
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

  // A file that failed, or a bundle that left on the way: nothing is stored.
  const isDiscarded = failures.length > 0 || record.status !== "loaded";

  if (isDiscarded) {
    discard(swap, failures, sizes);

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
