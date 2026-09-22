/**
 * @file assets plugin — API factory. `app.assets`: five members over the state, all of them
 * answering at once while headless.
 */
import { unloadBundle, usedMb } from "./budget";
import { withDeps } from "./lifecycle";
import { ignoreFailure, isPermanent, loadBundle, touch } from "./tiers";
import type { Api, AssetsCtx, BundleUsage, KernelSlice, Texture, Usage } from "./types";

/** The one message both refusals of `unload` carry. */
const REFUSED = "assets: this bundle cannot be unloaded";

/**
 * Answers the texture of one asset key. This is the function `renderer` gets through
 * `textures.provide`, and the one `app.assets.texture` calls: `onInit` has no access to the
 * plugin's own API, so both sides stand on the state.
 *
 * @param ctx - Domain context of the plugin.
 * @param key - Asset key.
 * @returns The texture, or `undefined` while its bundle is not loaded.
 * @example
 * ```ts
 * // A sprite of the board asks for its art before the bundle arrived.
 * lookupTexture(ctx, "board.cell"); // undefined, one warning, and the bundle starts loading
 * ```
 */
export function lookupTexture(ctx: AssetsCtx, key: string): Texture | undefined {
  const state = ctx.state;

  if (state.io === undefined) return undefined;

  const bundle = state.bundleOfKey.get(key);

  if (bundle === undefined) return undefined;

  const record = state.records.get(bundle);

  if (record?.status === "loaded") {
    touch(state, record);

    return record.textures.get(key);
  }

  // `warned` latches the log line only: one key says "not loaded yet" once, however many sprites
  // and frames ask for it.
  if (!state.warned.has(key)) {
    state.warned.add(key);
    ctx.log.warn("assets: texture is not loaded yet", { key, bundle });
  }

  // The request itself is not latched. A load that failed left the record idle, so the next miss
  // asks again; while one is running every caller joins it instead of starting a second.
  if (record?.status !== "loading") {
    loadBundle(ctx, bundle, undefined, "request").catch(ignoreFailure);
  }

  return undefined;
}

/**
 * Frees a bundle on request. A pinned bundle and a permanent tier are refused with a warning;
 * a running load is aborted first.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 */
function unload(ctx: AssetsCtx, bundle: string): void {
  const state = ctx.state;

  if (state.io === undefined) return;

  const entry = state.manifest.bundles[bundle];

  if (entry === undefined) return;

  if (state.pinned.has(bundle)) {
    ctx.log.warn(REFUSED, { bundle, reason: "pinned" });

    return;
  }

  if (isPermanent(entry.tier)) {
    ctx.log.warn(REFUSED, { bundle, reason: "tier" });

    return;
  }

  state.records.get(bundle)?.inflight?.controller.abort();
  unloadBundle(ctx, bundle, "request");
}

/**
 * Tells whether a bundle is there. Headless every bundle of the manifest counts as loaded.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 * @returns True when the bundle is loaded.
 */
function isLoaded(ctx: AssetsCtx, bundle: string): boolean {
  const state = ctx.state;

  if (state.io === undefined) return state.manifest.bundles[bundle] !== undefined;

  return state.records.get(bundle)?.status === "loaded";
}

/**
 * Reports what the loaded bundles cost.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The used and allowed megabytes and one entry per loaded bundle, sorted by name.
 */
function usage(ctx: AssetsCtx): Usage {
  const bundles: BundleUsage[] = [];

  for (const [name, record] of ctx.state.records) {
    const entry = ctx.state.manifest.bundles[name];

    if (record.status !== "loaded" || entry === undefined) continue;

    bundles.push({ name, tier: entry.tier, mb: entry.mb, lastUsed: record.lastUsed });
  }

  bundles.sort((left, right) => left.name.localeCompare(right.name));

  return {
    textureMb: usedMb(ctx.state),
    budgetMb: ctx.config.textureBudgetMb,
    bundles
  };
}

/**
 * Creates the assets API: `app.assets`.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @returns The plugin API.
 */
export function createAssetsApi(ctx: KernelSlice): Api {
  const assets = withDeps(ctx);

  return {
    load: (bundle: string): Promise<void> => loadBundle(assets, bundle, undefined, "request"),
    unload: (bundle: string): void => unload(assets, bundle),
    isLoaded: (bundle: string): boolean => isLoaded(assets, bundle),
    texture: (key: string): Texture | undefined => lookupTexture(assets, key),
    usage: (): Usage => usage(assets)
  };
}
