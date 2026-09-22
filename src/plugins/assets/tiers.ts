/**
 * @file assets plugin — loading one bundle and the boot sequence. One running load per bundle,
 * every caller a waiter: the last one to leave aborts the fetches.
 */
import { enforceBudget, releaseAssets } from "./budget";
import {
  atlasProblem,
  fileUrl,
  indexKeys,
  kindOf,
  nineOf,
  parseManifest,
  resolveBaseUrl
} from "./manifest";
import type {
  AssetsCtx,
  AssetsIo,
  BundleMap,
  BundleRecord,
  Events,
  FetchResponse,
  FontPage,
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

/** A load failure that knows which file of which bundle broke, for the log entry. */
type BundleFailure = Error & { bundle: string; file: string; status: number };

/** How far one running load got: the payload of the next `assets:bundle-progress`. */
type Progress = Events["assets:bundle-progress"];

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
 * Builds the error every waiter of a broken bundle rejects with.
 *
 * @param bundle - Name of the bundle.
 * @param file - Path of the file that broke.
 * @param status - HTTP status the response carried.
 * @returns The error, carrying the three fields for the log entry.
 */
function failure(bundle: string, file: string, status: number): BundleFailure {
  const error = new Error(
    `[game] assets: bundle "${bundle}" failed at "${file}" (${status}).`
  ) as BundleFailure;

  error.bundle = bundle;
  error.file = file;
  error.status = status;

  return error;
}

/**
 * Reads the three fields of a load failure, when the error carries them.
 *
 * @param error - What the load rejected with.
 * @returns The bundle, the file and the status, or `undefined`.
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
 * @example
 * ```ts
 * touch(state, record); // state.useCounter goes from 11 to 12 and record.lastUsed becomes 12
 * ```
 */
export function touch(state: State, record: BundleRecord): void {
  state.useCounter += 1;
  record.lastUsed = state.useCounter;
}

/**
 * Creates the three empty maps a bundle's assets live in. It is its own function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns Empty maps for textures, fonts and audio.
 */
function emptyAssets(): LoadedAssets {
  return { textures: new Map(), fonts: new Map(), audio: new Map() };
}

/**
 * Fetches one file of a bundle.
 *
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle, for the failure message.
 * @param path - Path of the file, relative to the scan root.
 * @param base - Prefix of every file URL.
 * @param signal - The signal of the running load.
 * @returns The response.
 * @throws {Error} When the response is not ok.
 */
async function fetchFile(
  io: AssetsIo,
  bundle: string,
  path: string,
  base: string,
  signal: AbortSignal
): Promise<FetchResponse> {
  const response = await io.fetch(fileUrl(base, path), { signal });

  if (!response.ok) throw failure(bundle, path, response.status);

  return response;
}

/**
 * Fetches, decodes and uploads one image.
 *
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle, for the failure message.
 * @param image - The file or the font page to upload.
 * @param base - Prefix of every file URL.
 * @param signal - The signal of the running load.
 * @returns The texture of the image.
 * @throws {Error} When the response is not ok.
 */
async function loadImage(
  io: AssetsIo,
  bundle: string,
  image: ManifestFile | FontPage,
  base: string,
  signal: AbortSignal
): Promise<Texture> {
  const response = await fetchFile(io, bundle, image.path, base, signal);
  const options = "key" in image ? nineOf(image) : undefined;

  return io.createTexture(await io.decode(await response.blob()), options);
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
 * Loads one font: the `.fnt` file as text and every page it names as a texture. The pages go up
 * in parallel, the first one is what `text` installs.
 *
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle, for the failure message.
 * @param file - The font file of the manifest.
 * @param base - Prefix of every file URL.
 * @param signal - The signal of the running load.
 * @returns The font file and its page textures.
 * @throws {Error} When a response is not ok, or the manifest lists no page.
 */
async function loadFont(
  io: AssetsIo,
  bundle: string,
  file: ManifestFile,
  base: string,
  signal: AbortSignal
): Promise<LoadedFont> {
  const entries = file.pages ?? [];

  if (entries.length === 0) throw pagelessFont(bundle, file.path);

  const response = await fetchFile(io, bundle, file.path, base, signal);
  const fnt = await response.text();
  const pages = await Promise.all(entries.map(page => loadImage(io, bundle, page, base, signal)));
  const [first] = pages;

  if (first === undefined) throw pagelessFont(bundle, file.path);

  return { fnt, texture: first, pages };
}

/**
 * Loads one file into the maps of the running load, by what the manifest says it is.
 *
 * @param io - The I/O seam.
 * @param bundle - Name of the bundle, for the failure message.
 * @param file - The file to load.
 * @param base - Prefix of every file URL.
 * @param into - Where the result goes, keyed by the asset key.
 * @param into.signal - The signal of the running load.
 * @param into.assets - The three maps of the running load.
 * @throws {Error} When the response is not ok, or a font lists no page.
 */
async function loadFile(
  io: AssetsIo,
  bundle: string,
  file: ManifestFile,
  base: string,
  into: { signal: AbortSignal; assets: LoadedAssets }
): Promise<void> {
  const { signal, assets } = into;
  const kind = kindOf(file);

  if (kind === "font") {
    assets.fonts.set(file.key, await loadFont(io, bundle, file, base, signal));

    return;
  }

  if (kind === "audio") {
    const response = await fetchFile(io, bundle, file.path, base, signal);

    assets.audio.set(file.key, await response.arrayBuffer());

    return;
  }

  assets.textures.set(file.key, await loadImage(io, bundle, file, base, signal));
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
 * @param assets - The textures, fonts and audio bytes the load produced.
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

  if (detail === undefined)
    ctx.log.error("assets: bundle failed", { bundle, error: String(error) });
  else {
    ctx.log.error("assets: bundle failed", {
      bundle: detail.bundle,
      file: detail.file,
      status: detail.status
    });
  }
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
    const problem = atlasProblem(bundle, entry.files);

    if (problem !== undefined) throw new Error(problem);

    // Load every file in parallel; each one that settles moves the progress on.
    const base = resolveBaseUrl(ctx.config.baseUrl, ctx.config.manifest);
    const into = { signal: inflight.controller.signal, assets };
    const progress: Progress = { bundle, loaded: 0, total: entry.files.length };
    const results = await Promise.allSettled(
      entry.files.map(file =>
        loadFile(io, bundle, file, base, into).finally(() =>
          reportSettled(ctx, progress, into.signal)
        )
      )
    );

    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
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
 * @example
 * ```ts
 * // The enter callback of a node, cancelled when the graph leaves it again.
 * await loadBundle(ctx, "board", enter.signal, "enter");
 * ```
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
 * Compares what the composed features declare with what the manifest carries. A disagreement is
 * one warning per bundle, never a failure: the game still runs on the manifest.
 *
 * @param ctx - Domain context of the plugin.
 */
function checkDeclaredBundles(ctx: AssetsCtx): void {
  for (const feature of ctx.deps.flow.features.all()) {
    for (const bundles of bundleMapsOf(feature.description.assets)) {
      for (const [name, spec] of Object.entries(bundles.map)) {
        const entry = ctx.state.manifest.bundles[name];
        const declared = (spec as { tier?: string } | undefined)?.tier;

        if (entry === undefined) {
          ctx.log.warn("assets: bundle is not in the manifest", {
            feature: feature.name,
            bundle: name,
            fix: 'Run "bun run assets:keys".'
          });
        } else if (declared !== undefined && declared !== entry.tier) {
          ctx.log.warn("assets: bundle tier disagrees with the manifest", {
            feature: feature.name,
            bundle: name,
            declared,
            manifest: entry.tier
          });
        }
      }
    }
  }
}

/**
 * Fetches the manifest. Headless there is no io, so the global `fetch` is used: a headless test
 * that points at a file still reads it.
 *
 * @param ctx - Domain context of the plugin.
 * @param url - Where the manifest lives.
 * @returns The parsed JSON.
 * @throws {Error} When the response is not ok.
 */
async function fetchManifest(ctx: AssetsCtx, url: string): Promise<unknown> {
  const controller = new AbortController();
  const io = ctx.state.io;
  const response =
    io === undefined
      ? await fetch(url, { signal: controller.signal })
      : await io.fetch(url, { signal: controller.signal });

  if (!response.ok) {
    throw new Error(
      `[game] assets: the manifest at "${url}" could not be read (${response.status}).\n` +
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
 * @example
 * ```ts
 * // What `startAssets` awaits before the game's first node runs.
 * await bootTiers(ctx);
 * ctx.state.manifest.bundles.boot; // the boot bundle, loaded
 * ```
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
