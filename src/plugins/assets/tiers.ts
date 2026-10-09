/**
 * @file assets plugin — loading one bundle and the boot sequence. One running load per bundle,
 * every caller a waiter: the last one to leave aborts the fetches. The loaders of one image, one
 * font and one sound are exported: the dev hot swap of `swap.ts` reads a changed file through them.
 */
import { enforceBudget, releaseAssets } from "./budget";
import { fileUrl, indexKeys, kindOf, nineOf, parseManifest, resolveBaseUrl } from "./manifest";
import type {
  AssetsCtx,
  AssetsIo,
  AtlasFrame,
  AtlasPage,
  AudioAsset,
  AudioMime,
  BundleMap,
  BundleRecord,
  CreateTextureOptions,
  Events,
  FetchResponse,
  Inflight,
  LoadedAssets,
  LoadedFont,
  LoadReason,
  Manifest,
  ManifestBundle,
  ManifestFile,
  State,
  Texture,
  Tier
} from "./types";

/** The extension of an AAC sound in an MP4 container; every other sound is an MP3. */
const M4A = /\.m4a$/i;

/** A load failure that knows which file of which bundle broke, for the log entry. */
type BundleFailure = Error & {
  bundle: string;
  file: string;
  status: number;
  contentType: string | undefined;
};

/** How far one running load got: the payload of the next `assets:bundle-progress`. */
type Progress = Events["assets:bundle-progress"];

/**
 * One running load of a bundle, as the file loaders see it: where the files come from, the
 * signal that cancels them and the maps they fill.
 */
export type Loading = {
  io: AssetsIo;
  bundle: string;
  base: string;
  signal: AbortSignal;
  assets: LoadedAssets;
};

/** A running load once its atlas pages are on the way: the promise of each page by its id. */
type Running = Loading & { pages: ReadonlyMap<string, Promise<Texture>> };

/**
 * Tells whether a tier stays for the whole session. A permanent bundle is never evicted and
 * `unload` refuses it.
 *
 * @param tier - Tier of a bundle.
 * @returns True for `boot` and `core`.
 * @example
 * ```ts
 * isPermanent("core"); // true
 * ```
 */
export function isPermanent(tier: Tier): boolean {
  return tier === "boot" || tier === "core";
}

/**
 * Tells whether an error is an abort. An abort is a decision, not a failure: it is never logged.
 *
 * @param error - What a load rejected with.
 * @returns True for an `AbortError`.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Swallows the rejection of a load the caller does not wait for: a `core` bundle started at boot,
 * the background load behind a texture miss, a preloaded bundle. What broke was logged where it
 * broke, so there is nothing left to do here.
 *
 * @example
 * ```ts
 * loadBundle(ctx, "ui", undefined, "boot").catch(ignoreFailure); // the game starts either way
 * ```
 */
export function ignoreFailure(): void {
  // Deliberately empty: `fail` already wrote the log entry.
}

/**
 * Builds the error a cancelled caller rejects with.
 *
 * @returns An error whose `name` is `"AbortError"`.
 */
function abortError(): Error {
  const error = new Error("[game] assets: the load was aborted.");

  error.name = "AbortError";

  return error;
}

/**
 * Builds the error of a bundle the manifest does not carry.
 *
 * @param bundle - The name the caller used.
 * @returns The error, with the command that fixes it.
 * @example
 * ```ts
 * unknownBundle("bord").message;
 * // '[game] assets: no bundle "bord" in the manifest.\n  Run "bun run assets:keys".'
 * ```
 */
export function unknownBundle(bundle: string): Error {
  return new Error(
    `[game] assets: no bundle "${bundle}" in the manifest.\n  Run "bun run assets:keys".`
  );
}

/**
 * Reads the `content-type` header of a response.
 *
 * @param response - The response.
 * @returns The header, or `undefined` when the response has none.
 */
function contentTypeOf(response: FetchResponse): string | undefined {
  return response.headers.get("content-type") ?? undefined;
}

/**
 * Tells whether a response does not carry the file it was asked for. On `tauri://` a missing
 * file comes back `200` with the body of `index.html`, so `text/html` for a path that is not an
 * `.html` file counts as missing too. Nothing else reads the type: decoding goes by extension.
 *
 * @param response - The response.
 * @param path - What was asked for: the path of a file or the URL of the manifest.
 * @returns `true` when the file is missing.
 */
function isMissing(response: FetchResponse, path: string): boolean {
  if (!response.ok) return true;

  const servedHtml = contentTypeOf(response)?.startsWith("text/html") === true;

  return servedHtml && !path.endsWith(".html");
}

/**
 * Names the status and the type of a missing file for an error message.
 *
 * @param status - HTTP status the response carried.
 * @param contentType - Its `content-type`, when it had one.
 * @returns The status alone, or the status and the type.
 * @example
 * ```ts
 * missingLabel(200, "text/html"); // "200, text/html"
 * ```
 */
function missingLabel(status: number, contentType: string | undefined): string {
  return contentType === undefined ? String(status) : `${status}, ${contentType}`;
}

/**
 * Builds the error every waiter of a broken bundle rejects with.
 *
 * @param bundle - Name of the bundle.
 * @param file - Path of the file that broke.
 * @param response - The response that did not carry it.
 * @returns The error, carrying the four fields for the log entry.
 */
function failure(bundle: string, file: string, response: FetchResponse): BundleFailure {
  const contentType = contentTypeOf(response);
  const error = new Error(
    `[game] assets: bundle "${bundle}" failed at "${file}" ` +
      `(${missingLabel(response.status, contentType)}).`
  ) as BundleFailure;

  error.bundle = bundle;
  error.file = file;
  error.status = response.status;
  error.contentType = contentType;

  return error;
}

/**
 * Reads the three fields of a load failure, when the error carries them.
 *
 * @param error - What the load rejected with.
 * @returns The bundle, the file, the status and the type, or `undefined`.
 */
function failureDetail(error: unknown): BundleFailure | undefined {
  if (error instanceof Error && typeof (error as BundleFailure).file === "string") {
    return error as BundleFailure;
  }

  return undefined;
}

/**
 * Reads the record of a bundle, creating an idle one on the first touch.
 *
 * @param state - The plugin state.
 * @param bundle - Name of the bundle.
 * @returns The record.
 */
function recordOf(state: State, bundle: string): BundleRecord {
  const existing = state.records.get(bundle);

  if (existing !== undefined) return existing;

  const created: BundleRecord = {
    status: "idle",
    ...emptyAssets(),
    inflight: undefined,
    lastUsed: 0
  };

  state.records.set(bundle, created);

  return created;
}

/**
 * Stamps a bundle with the next value of the use counter. That counter, never a clock, is what
 * the LRU compares.
 *
 * @param state - The plugin state.
 * @param record - Record of the bundle that was used.
 */
export function touch(state: State, record: BundleRecord): void {
  state.useCounter += 1;
  record.lastUsed = state.useCounter;
}

/**
 * Creates the four empty maps a bundle's assets live in: the home of a running load.
 *
 * @returns Empty maps for textures, fonts, audio and atlas pages.
 * @example
 * ```ts
 * emptyAssets().textures.size; // 0
 * ```
 */
export function emptyAssets(): LoadedAssets {
  return { textures: new Map(), fonts: new Map(), audio: new Map(), pages: new Map() };
}

/**
 * Fetches one file of a bundle.
 *
 * @param run - The running load.
 * @param path - Path of the file, relative to the folder of the manifest's files.
 * @returns The response.
 * @throws {Error} When the file is missing: not ok, or `text/html` for a file that is not html.
 */
async function fetchFile(run: Loading, path: string): Promise<FetchResponse> {
  const response = await run.io.fetch(fileUrl(run.base, path), { signal: run.signal });

  if (isMissing(response, path)) throw failure(run.bundle, path, response);

  return response;
}

/**
 * Fetches, decodes and uploads one image: a loose texture, a font page or an atlas page.
 *
 * @param run - The running load.
 * @param path - Path of the image.
 * @param options - The nine-slice borders of a loose texture; none for a page.
 * @returns The texture of the image.
 * @throws {Error} When the response is not ok.
 */
export async function loadImage(
  run: Loading,
  path: string,
  options?: CreateTextureOptions
): Promise<Texture> {
  const response = await fetchFile(run, path);

  return run.io.createTexture(await run.io.decode(await response.blob()), options);
}

/**
 * Builds the error of a font the manifest lists without a page.
 *
 * @param bundle - Name of the bundle.
 * @param path - Path of the `.fnt` file.
 * @returns The error, with the command that fixes it.
 */
function pagelessFont(bundle: string, path: string): Error {
  return new Error(
    `[game] assets: font "${path}" of bundle "${bundle}" has no page.\n` +
      '  Run "bun run assets:keys".'
  );
}

/**
 * Reads the path of a file that is fetched: a loose texture, a font or a sound. Only a texture
 * packed in an atlas may lack one.
 *
 * @param bundle - Name of the bundle, for the message.
 * @param file - The file of the manifest.
 * @returns The path.
 * @throws {Error} When the file has no path.
 */
function pathOf(bundle: string, file: ManifestFile): string {
  if (file.path !== undefined) return file.path;

  throw new Error(
    `[game] assets: file "${file.key}" of bundle "${bundle}" has neither a path nor an atlas frame.\n` +
      '  Run "bun run assets:pack".'
  );
}

/**
 * Reads the container type of a sound from the extension of its path. A hashed name of the packer
 * keeps the extension, so a packed sound has the type of its source.
 *
 * @param soundPath - Path of the sound, as the manifest names it.
 * @returns `"audio/mp4"` for an `.m4a`, `"audio/mpeg"` for everything else.
 * @example
 * ```ts
 * mimeOf("ui/ui.theme-9c4e2b7a10.m4a"); // "audio/mp4"
 * ```
 */
function mimeOf(soundPath: string): AudioMime {
  return M4A.test(soundPath) ? "audio/mp4" : "audio/mpeg";
}

/**
 * Loads one font: the `.fnt` file as text and every page it names as a texture. The pages go up
 * in parallel, the first one is what `text` installs.
 *
 * @param run - The running load.
 * @param file - The font file of the manifest.
 * @returns The font file and its page textures.
 * @throws {Error} When a response is not ok, or the manifest lists no page.
 */
export async function loadFont(run: Loading, file: ManifestFile): Promise<LoadedFont> {
  const path = pathOf(run.bundle, file);
  const entries = file.pages ?? [];

  if (entries.length === 0) throw pagelessFont(run.bundle, path);

  const response = await fetchFile(run, path);
  const fnt = await response.text();
  const pages = await Promise.all(entries.map(page => loadImage(run, page.path)));
  const [first] = pages;

  if (first === undefined) throw pagelessFont(run.bundle, path);

  return { fnt, texture: first, pages };
}

/**
 * Loads one sound: the bytes exactly as they were fetched, never decoded here, and the type of
 * their container.
 *
 * @param run - The running load.
 * @param file - The audio file of the manifest.
 * @returns The bytes and their MIME type.
 * @throws {Error} When the response is not ok.
 */
export async function loadSound(run: Loading, file: ManifestFile): Promise<AudioAsset> {
  const soundPath = pathOf(run.bundle, file);
  const response = await fetchFile(run, soundPath);

  return { bytes: await response.arrayBuffer(), mime: mimeOf(soundPath) };
}

/**
 * Starts the one load of every atlas page of a bundle. A page lands in the `pages` map of the
 * running load, so a failure later frees it with the rest. Nobody may wait for a page, so its
 * failure is marked as handled here; the files on it still reject with it.
 *
 * @param run - The running load, whose `assets.pages` map is filled.
 * @param pages - The pages the bundle lists.
 * @returns Page id to the promise of its texture.
 */
function startPages(run: Loading, pages: readonly AtlasPage[]): Map<string, Promise<Texture>> {
  const started = new Map<string, Promise<Texture>>();

  for (const page of pages) {
    const promise = loadImage(run, page.path).then(texture => {
      run.assets.pages.set(page.id, texture);

      return texture;
    });

    promise.catch(ignoreFailure);
    started.set(page.id, promise);
  }

  return started;
}

/**
 * Builds the error of a packed file whose page the bundle does not list.
 *
 * @param bundle - Name of the bundle.
 * @param key - Asset key of the file.
 * @param page - The page id its `atlas` frame names.
 * @returns The error, with the command that fixes it.
 * @example
 * ```ts
 * unlistedPage("ui", "ui.icon-coin", "ui/main-9").message;
 * // '[game] assets: file "ui.icon-coin" of bundle "ui" names page "ui/main-9", which the bundle does not list.\n  Run "bun run assets:pack".'
 * ```
 */
function unlistedPage(bundle: string, key: string, page: string): Error {
  return new Error(
    `[game] assets: file "${key}" of bundle "${bundle}" names page "${page}", ` +
      'which the bundle does not list.\n  Run "bun run assets:pack".'
  );
}

/**
 * Cuts one packed file out of its page, once the page landed. Nothing is fetched for the file.
 *
 * @param run - The running load.
 * @param file - The packed file.
 * @param atlas - Its frame on the page.
 * @returns The slice.
 * @throws {Error} When the page is not listed by the bundle, or did not arrive.
 */
async function sliceFile(run: Running, file: ManifestFile, atlas: AtlasFrame): Promise<Texture> {
  const page = run.pages.get(atlas.page);

  if (page === undefined) throw unlistedPage(run.bundle, file.key, atlas.page);

  return run.io.sliceTexture(await page, atlas, nineOf(file));
}

/**
 * Loads one file into the maps of the running load, by what the manifest says it is. A texture
 * with an `atlas` frame is cut out of its page; any other file is fetched by its path.
 *
 * @param run - The running load.
 * @param file - The file to load.
 * @throws {Error} When a response is not ok, a font lists no page, or a page is missing.
 */
async function loadFile(run: Running, file: ManifestFile): Promise<void> {
  const { assets } = run;
  const kind = kindOf(file);

  if (kind === "font") {
    assets.fonts.set(file.key, await loadFont(run, file));

    return;
  }

  if (kind === "audio") {
    assets.audio.set(file.key, await loadSound(run, file));

    return;
  }

  const texture =
    file.atlas === undefined
      ? await loadImage(run, pathOf(run.bundle, file), nineOf(file))
      : await sliceFile(run, file, file.atlas);

  assets.textures.set(file.key, texture);
}

/**
 * Throws the first failure among settled loads, in the order they were started.
 *
 * @param results - What `Promise.allSettled` gave back.
 * @throws {Error} The reason of the first rejected load.
 */
function throwFirstFailure(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}

/**
 * Counts one settled file of a running load and tells the game how far the bundle got. The files
 * of an aborted load settle only because they were cancelled, so they report nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @param progress - The count of the running load, moved on by one.
 * @param signal - The signal of the running load.
 */
function reportSettled(ctx: AssetsCtx, progress: Progress, signal: AbortSignal): void {
  if (signal.aborted) return;

  progress.loaded += 1;
  ctx.emit("assets:bundle-progress", { ...progress });
}

/**
 * Publishes a loaded bundle: what was loaded moves into the record, `renderer` re-resolves the
 * keys, the event goes out, the frame loop wakes and the budget is enforced.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 * @param entry - Its manifest entry.
 * @param assets - The textures, fonts, sounds and pages the load produced.
 * @param reason - Why the load was started.
 */
function finish(
  ctx: AssetsCtx,
  bundle: string,
  entry: ManifestBundle,
  assets: LoadedAssets,
  reason: LoadReason
): void {
  const record = recordOf(ctx.state, bundle);

  record.textures = assets.textures;
  record.fonts = assets.fonts;
  record.audio = assets.audio;
  record.pages = assets.pages;
  record.status = "loaded";
  record.inflight = undefined;
  touch(ctx.state, record);

  ctx.deps.renderer.sync.textures.invalidate(entry.files.map(file => file.key));

  ctx.emit("assets:bundle-loaded", { bundle, tier: entry.tier, mb: entry.mb, reason });
  // The picture changes now: the sprites that waited for these keys resolve on the next frame.
  ctx.deps.time.wake();
  enforceBudget(ctx);
}

/**
 * Rolls one failed load back: what was uploaded is destroyed, the record goes idle and the error
 * waits on the inflight record for every waiter.
 *
 * @param ctx - Domain context of the plugin.
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle.
 * @param inflight - The running load.
 * @param assets - What was loaded before the failure.
 * @param error - What broke.
 */
function fail(
  ctx: AssetsCtx,
  io: AssetsIo,
  bundle: string,
  inflight: Inflight,
  assets: LoadedAssets,
  error: unknown
): void {
  const record = recordOf(ctx.state, bundle);

  releaseAssets(io, assets);

  record.status = "idle";
  record.inflight = undefined;
  inflight.error = error;

  if (isAbortError(error)) return;

  const detail = failureDetail(error);

  if (detail === undefined) {
    ctx.log.error("assets: bundle failed", { bundle, error: String(error) });

    return;
  }

  ctx.log.error("assets: bundle failed", {
    bundle: detail.bundle,
    file: detail.file,
    status: detail.status,
    contentType: detail.contentType
  });
}

/**
 * Runs one load to its end. It never rejects: the error is stored on the inflight record, so a
 * load nobody waits for any more cannot become an unhandled rejection. Every settled file sends
 * `assets:bundle-progress`; the last one comes before `assets:bundle-loaded`.
 *
 * @param ctx - Domain context of the plugin.
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle.
 * @param entry - Its manifest entry.
 * @param inflight - The running load.
 * @param reason - Why the load was started.
 */
async function runLoad(
  ctx: AssetsCtx,
  io: AssetsIo,
  bundle: string,
  entry: ManifestBundle,
  inflight: Inflight,
  reason: LoadReason
): Promise<void> {
  const assets = emptyAssets();

  try {
    // Every page goes up once; the files on a page wait for it and are cut out of it.
    const base = resolveBaseUrl(ctx.config.baseUrl, ctx.config.manifest);
    const loading = { io, bundle, base, signal: inflight.controller.signal, assets };
    const run: Running = { ...loading, pages: startPages(loading, entry.pages ?? []) };
    // Load every file in parallel; each one that settles moves the progress on.
    const progress: Progress = { bundle, loaded: 0, total: entry.files.length };
    const files = await Promise.allSettled(
      entry.files.map(file =>
        loadFile(run, file).finally(() => reportSettled(ctx, progress, run.signal))
      )
    );
    // A page no file waited for still lands before the load is published or rolled back.
    const pages = await Promise.allSettled(run.pages.values());

    throwFirstFailure(files);
    throwFirstFailure(pages);
  } catch (error) {
    fail(ctx, io, bundle, inflight, assets, error);

    return;
  }

  finish(ctx, bundle, entry, assets, reason);
}

/**
 * Starts the one load of a bundle and records it.
 *
 * @param ctx - Domain context of the plugin.
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle.
 * @param entry - Its manifest entry.
 * @param reason - Why this caller wants it.
 * @returns The running load.
 */
function begin(
  ctx: AssetsCtx,
  io: AssetsIo,
  bundle: string,
  entry: ManifestBundle,
  reason: LoadReason
): Inflight {
  const record = recordOf(ctx.state, bundle);
  const inflight: Inflight = {
    promise: Promise.resolve(),
    controller: new AbortController(),
    waiters: 0,
    error: undefined
  };

  record.status = "loading";
  record.inflight = inflight;
  inflight.promise = runLoad(ctx, io, bundle, entry, inflight, reason);

  return inflight;
}

/**
 * Waits for a promise, or for the caller's own signal, whichever comes first.
 *
 * @param promise - The running load, which never rejects.
 * @param signal - The caller's signal, or `undefined` when it cannot be cancelled.
 * @returns A promise that rejects with an `AbortError` when the signal fires.
 */
function race(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Joins a running load as one more waiter. When the last waiter leaves while the load still runs,
 * the fetches are aborted and the bundle goes back to idle.
 *
 * @param record - Record of the bundle.
 * @param inflight - The running load.
 * @param signal - The caller's signal.
 * @throws {Error} With the caller's `AbortError`, or with the failure of the load.
 */
async function waitFor(
  record: BundleRecord,
  inflight: Inflight,
  signal: AbortSignal | undefined
): Promise<void> {
  inflight.waiters += 1;

  try {
    await race(inflight.promise, signal);
  } finally {
    inflight.waiters -= 1;

    if (inflight.waiters === 0 && record.status === "loading") inflight.controller.abort();
  }

  if (inflight.error !== undefined) throw inflight.error;
}

/**
 * Loads every file of one bundle. A second caller joins the running load instead of fetching
 * again; the reason of the event stays the reason of the caller that started it.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of a bundle of the manifest.
 * @param signal - The caller's signal, or `undefined`.
 * @param reason - Why this caller wants the bundle.
 * @returns A promise that resolves when every texture of the bundle exists.
 * @throws {Error} When the manifest has no such bundle, when a file fails and on an abort.
 */
export async function loadBundle(
  ctx: AssetsCtx,
  bundle: string,
  signal: AbortSignal | undefined,
  reason: LoadReason
): Promise<void> {
  const state = ctx.state;
  const io = state.io;

  if (io === undefined) return;

  const entry = state.manifest.bundles[bundle];

  if (entry === undefined) throw unknownBundle(bundle);

  const record = recordOf(state, bundle);

  if (record.status === "loaded") {
    touch(state, record);

    return;
  }

  await waitFor(record, record.inflight ?? begin(ctx, io, bundle, entry, reason), signal);
}

/**
 * Lists the bundles of one tier, in manifest order.
 *
 * @param manifest - The parsed manifest.
 * @param tier - The tier to collect.
 * @returns The bundle names.
 */
function bundlesOfTier(manifest: Manifest, tier: Tier): string[] {
  return Object.entries(manifest.bundles)
    .filter(([, entry]) => entry.tier === tier)
    .map(([name]) => name);
}

/**
 * Reads the bundle maps a feature description carries under the key `assets`.
 *
 * @param value - What the feature put there.
 * @returns Every bundle map it brought.
 */
function bundleMapsOf(value: unknown): BundleMap[] {
  const entries = Array.isArray(value) ? value : [value];

  return entries.filter(
    (entry): entry is BundleMap =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { kind?: unknown }).kind === "bundles"
  );
}

/**
 * Warns when one bundle a feature declares disagrees with the manifest: the manifest has no such
 * bundle, or it carries the bundle under another tier.
 *
 * @param ctx - Domain context of the plugin.
 * @param feature - Name of the feature that declared the bundle.
 * @param name - Name of the bundle.
 * @param spec - What the feature declared for it.
 */
function checkDeclaredBundle(ctx: AssetsCtx, feature: string, name: string, spec: unknown): void {
  const entry = ctx.state.manifest.bundles[name];

  if (entry === undefined) {
    ctx.log.warn("assets: bundle is not in the manifest", {
      feature,
      bundle: name,
      fix: 'Run "bun run assets:keys".'
    });

    return;
  }

  const declared = (spec as { tier?: string } | undefined)?.tier;

  if (declared === undefined || declared === entry.tier) return;

  ctx.log.warn("assets: bundle tier disagrees with the manifest", {
    feature,
    bundle: name,
    declared,
    manifest: entry.tier
  });
}

/**
 * Compares what the composed features declare with what the manifest carries. A disagreement is
 * one warning per bundle, never a failure: the game still runs on the manifest.
 *
 * @param ctx - Domain context of the plugin.
 */
function checkDeclaredBundles(ctx: AssetsCtx): void {
  for (const feature of ctx.deps.flow.features.all()) {
    const declared = bundleMapsOf(feature.description.assets).flatMap(bundles =>
      Object.entries(bundles.map)
    );

    for (const [name, spec] of declared) checkDeclaredBundle(ctx, feature.name, name, spec);
  }
}

/**
 * Fetches the manifest. Headless there is no io, so the global `fetch` is used: a headless test
 * that points at a file still reads it.
 *
 * @param ctx - Domain context of the plugin.
 * @param url - Where the manifest lives.
 * @returns The parsed JSON.
 * @throws {Error} When the manifest is missing: not ok, or served as `text/html`.
 */
async function fetchManifest(ctx: AssetsCtx, url: string): Promise<unknown> {
  const controller = new AbortController();
  const io = ctx.state.io;
  const response =
    io === undefined
      ? await fetch(url, { signal: controller.signal })
      : await io.fetch(url, { signal: controller.signal });

  if (isMissing(response, url)) {
    const label = missingLabel(response.status, contentTypeOf(response));

    throw new Error(
      `[game] assets: the manifest at "${url}" could not be read (${label}).\n` +
        '  Run "bun run assets:keys" and publish the file.'
    );
  }

  return response.json();
}

/**
 * Reads the manifest into the state and builds the key index.
 *
 * @param ctx - Domain context of the plugin.
 * @throws {Error} In a browser, when the manifest cannot be read.
 */
async function readManifest(ctx: AssetsCtx): Promise<void> {
  const source = ctx.config.manifest;

  if (source === undefined) return;

  try {
    const raw = typeof source === "string" ? await fetchManifest(ctx, source) : source;

    ctx.state.manifest = parseManifest(raw);
    ctx.state.bundleOfKey = indexKeys(ctx.state.manifest);
  } catch (error) {
    if (ctx.state.io !== undefined) throw error;

    ctx.log.warn("assets: the manifest could not be read", { error: String(error) });
  }
}

/**
 * The boot sequence of `onStart`: read the manifest, check what the features declared, await the
 * `boot` tier and start the `core` tier without awaiting it, so a loading screen can show real
 * progress by joining the same loads.
 *
 * @param ctx - Domain context of the plugin.
 * @returns A promise that resolves once the manifest and the `boot` tier are there.
 * @throws {Error} In a browser, when the manifest or a boot bundle cannot be read.
 */
export async function bootTiers(ctx: AssetsCtx): Promise<void> {
  await readManifest(ctx);
  checkDeclaredBundles(ctx);

  await Promise.all(
    bundlesOfTier(ctx.state.manifest, "boot").map(name => loadBundle(ctx, name, undefined, "boot"))
  );

  for (const name of bundlesOfTier(ctx.state.manifest, "core")) {
    loadBundle(ctx, name, undefined, "boot").catch(ignoreFailure);
  }
}
