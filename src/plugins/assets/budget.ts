/**
 * @file assets plugin — texture memory: what is used, who leaves next and the eviction itself.
 * The LRU compares the use counter, never a clock.
 */

import { isPermanent } from "./tiers";
import type { AssetsCtx, AssetsIo, LoadedAssets, State } from "./types";

/** How many of the heaviest files the over-budget warning names. */
const HEAVIEST = 5;

/**
 * Adds up the estimated texture memory of every loaded bundle.
 *
 * @param state - The plugin state.
 * @returns The used megabytes.
 * @example
 * ```ts
 * usedMb(state); // 3.5 while only the board bundle is loaded
 * ```
 */
export function usedMb(state: State): number {
  let total = 0;

  for (const [name, record] of state.records) {
    if (record.status !== "loaded") continue;

    total += state.manifest.bundles[name]?.mb ?? 0;
  }

  return total;
}

/**
 * Picks the bundle that leaves next: the loaded one with the smallest use counter that is not
 * pinned, not permanent and not in the preload queue.
 *
 * @param state - The plugin state.
 * @returns The bundle name, or `undefined` when nothing may go.
 * @example
 * ```ts
 * pickVictim(state); // "shop", the scene the player left longest ago
 * ```
 */
export function pickVictim(state: State): string | undefined {
  let victim: string | undefined;
  let smallest = Number.POSITIVE_INFINITY;

  for (const [name, record] of state.records) {
    const entry = state.manifest.bundles[name];

    if (record.status !== "loaded" || entry === undefined) continue;
    if (state.pinned.has(name) || isPermanent(entry.tier)) continue;
    if (state.queue?.bundles.includes(name) === true) continue;
    if (record.lastUsed >= smallest) continue;

    smallest = record.lastUsed;
    victim = name;
  }

  return victim;
}

/**
 * Frees what a bundle brought and empties its three maps: every texture and every font page goes
 * back to the GPU, the audio bytes go to the garbage collector. Headless there is no io and
 * nothing to destroy, so only the maps are emptied.
 *
 * @param io - The I/O seam, or `undefined` while headless.
 * @param assets - The maps of a loaded bundle, or of a load that broke half way.
 * @example
 * ```ts
 * // The load of the ui bundle failed after two of its four files were there.
 * releaseAssets(io, assets); // both textures destroyed, every map empty
 * ```
 */
export function releaseAssets(io: AssetsIo | undefined, assets: LoadedAssets): void {
  if (io !== undefined) {
    for (const texture of assets.textures.values()) io.destroyTexture(texture);

    for (const font of assets.fonts.values()) {
      for (const page of font.pages) io.destroyTexture(page);
    }
  }

  assets.textures.clear();
  assets.fonts.clear();
  assets.audio.clear();
}

/**
 * Frees one loaded bundle: the textures are destroyed, `renderer` is told that its keys are gone
 * and the event goes out. A bundle that is not loaded is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 * @param reason - Whether the budget or a caller asked for it.
 * @example
 * ```ts
 * // The timed event ended and its textures go back to the GPU.
 * unloadBundle(ctx, "event.halloween", "request");
 * ```
 */
export function unloadBundle(ctx: AssetsCtx, bundle: string, reason: "budget" | "request"): void {
  const state = ctx.state;
  const record = state.records.get(bundle);
  const entry = state.manifest.bundles[bundle];

  if (record === undefined || entry === undefined || record.status !== "loaded") return;

  releaseAssets(state.io, record);

  record.status = "idle";
  record.lastUsed = 0;

  const keys = entry.files.map(file => file.key);

  ctx.deps.renderer.sync.textures.invalidate(keys);

  // `keys` is what `text` and `audio` release: each of them made something per key.
  ctx.emit("assets:bundle-unloaded", { bundle, tier: entry.tier, mb: entry.mb, reason, keys });
}

/**
 * Warns once that the loaded art does not fit, and names the five heaviest files: the cure is
 * smaller art or a split bundle, which is a decision for a person.
 *
 * @param ctx - Domain context of the plugin.
 */
function warnOverBudget(ctx: AssetsCtx): void {
  const files: Array<{ key: string; mb: number }> = [];

  for (const [name, record] of ctx.state.records) {
    if (record.status !== "loaded") continue;

    for (const file of ctx.state.manifest.bundles[name]?.files ?? []) {
      files.push({ key: file.key, mb: file.mb });
    }
  }

  files.sort((left, right) => right.mb - left.mb || left.key.localeCompare(right.key));

  ctx.log.warn("assets: over the texture budget with nothing to unload", {
    usedMb: Number(usedMb(ctx.state).toFixed(3)),
    budgetMb: ctx.config.textureBudgetMb,
    heaviest: files.slice(0, HEAVIEST)
  });
}

/**
 * Unloads bundles until the budget holds again. It runs after every load and at every rest node.
 * Headless there is no texture memory, so it does nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @example
 * ```ts
 * // After a scene switch loaded 40 MB over the 192 MB budget.
 * enforceBudget(ctx); // the least recently used scenes are freed until it fits
 * ```
 */
export function enforceBudget(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.io === undefined) return;

  while (usedMb(state) > ctx.config.textureBudgetMb) {
    const victim = pickVictim(state);

    if (victim === undefined) {
      warnOverBudget(ctx);

      return;
    }

    unloadBundle(ctx, victim, "budget");
  }
}
