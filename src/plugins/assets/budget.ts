/**
 * @file assets plugin — texture memory: what is used, who leaves next and the eviction itself,
 * and the release of a `"leave"` bundle whose feature left. The LRU compares the use counter,
 * never a clock.
 */

import { Exiting } from "../world/ecs/define";
import { unloadCompanions } from "./companions";
import { isPermanent } from "./tiers";
import type { AssetsCtx, AssetsIo, Events, LoadedAssets, ManifestBundle, State } from "./types";

/** How many of the heaviest entries the over-budget warning names. */
const HEAVIEST = 5;

/** One row of the over-budget warning: a loose file by its key, or a page as `page "<id>"`. */
type Heavy = { key: string; mb: number };

/** Why a bundle was unloaded: the budget, a caller, or its feature left. */
type UnloadReason = Events["assets:bundle-unloaded"]["reason"];

/**
 * Adds up the estimated texture memory of every loaded bundle.
 *
 * @param state - The plugin state.
 * @returns The used megabytes.
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
 * pinned, not named by the mounted scene, not permanent and not in the preload queue. Its
 * `release` is not read: a `"leave"` bundle is a candidate like any other.
 *
 * @param state - The plugin state.
 * @returns The bundle name, or `undefined` when nothing may go.
 */
export function pickVictim(state: State): string | undefined {
  let victim: string | undefined;
  let smallest = Number.POSITIVE_INFINITY;

  for (const [name, record] of state.records) {
    const entry = state.manifest.bundles[name];

    if (record.status !== "loaded" || entry === undefined) continue;
    if (state.pinned.has(name) || isPermanent(entry.tier)) continue;
    if (state.sceneNamed.includes(name) || state.sceneLeaving.includes(name)) continue;
    if (state.queue?.bundles.includes(name) === true) continue;
    if (record.lastUsed >= smallest) continue;

    smallest = record.lastUsed;
    victim = name;
  }

  return victim;
}

/**
 * Gives every texture, every atlas page and every font page of a bundle back to the GPU. The
 * textures go first, because a slice of a packed file frees only itself and its page frees the
 * source they share; then the pages, then the font pages.
 *
 * @param io - The I/O seam.
 * @param assets - The maps of a loaded bundle, or of a load that broke half way.
 */
function destroyGpuAssets(io: AssetsIo, assets: LoadedAssets): void {
  for (const texture of assets.textures.values()) io.destroyTexture(texture);

  for (const page of assets.pages.values()) io.destroyTexture(page);

  for (const font of assets.fonts.values()) {
    for (const page of font.pages) io.destroyTexture(page);
  }
}

/**
 * Frees what a bundle brought and empties its four maps: the textures and pages go back to the
 * GPU, the audio bytes go to the garbage collector. Headless there is no io and nothing to
 * destroy, so only the maps are emptied.
 *
 * @param io - The I/O seam, or `undefined` while headless.
 * @param assets - The maps of a loaded bundle, or of a load that broke half way.
 */
export function releaseAssets(io: AssetsIo | undefined, assets: LoadedAssets): void {
  if (io !== undefined) destroyGpuAssets(io, assets);

  assets.textures.clear();
  assets.pages.clear();
  assets.fonts.clear();
  assets.audio.clear();
}

/**
 * Frees one loaded bundle: the textures are destroyed, every companion drops what travels with
 * it, `renderer` is told that its keys are gone and the event goes out. A bundle that is not
 * loaded is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 * @param reason - Whether the budget, a caller or the release of a left feature asked for it.
 */
export function unloadBundle(ctx: AssetsCtx, bundle: string, reason: UnloadReason): void {
  const state = ctx.state;
  const record = state.records.get(bundle);
  const entry = state.manifest.bundles[bundle];

  if (record === undefined || entry === undefined || record.status !== "loaded") return;

  releaseAssets(state.io, record);

  record.status = "idle";
  record.lastUsed = 0;

  unloadCompanions(ctx, state.companions, bundle);

  const keys = entry.files.map(file => file.key);

  ctx.deps.renderer.sync.textures.invalidate(keys);

  // `keys` is what `text` and `audio` release: each of them made something per key.
  ctx.emit("assets:bundle-unloaded", { bundle, tier: entry.tier, mb: entry.mb, reason, keys });

  // Inline and positive, as the load: the performance log of an agent build names the unload.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    ctx.deps.renderer.monitor.event("bundle", {
      bundle,
      action: "unload",
      tier: entry.tier,
      mb: entry.mb,
      reason
    });
  }
}

/**
 * Lists what the loaded bundles cost, entry by entry: every file that is not packed, and every
 * atlas page as `page "<id>"`. A packed file costs nothing of its own: its page carries it.
 *
 * @param state - The plugin state.
 * @returns One row per loose file and per page.
 */
function heavyRows(state: State): Heavy[] {
  const rows: Heavy[] = [];

  for (const [name, record] of state.records) {
    const entry = state.manifest.bundles[name];

    if (record.status !== "loaded" || entry === undefined) continue;

    for (const file of entry.files) {
      if (file.atlas === undefined) rows.push({ key: file.key, mb: file.mb });
    }

    for (const page of entry.pages ?? []) rows.push({ key: `page "${page.id}"`, mb: page.mb });
  }

  return rows;
}

/**
 * Warns once that the loaded art does not fit, and names the five heaviest entries, loose files
 * and atlas pages together: the cure is smaller art or a split bundle, which is a decision for a
 * person.
 *
 * @param ctx - Domain context of the plugin.
 */
function warnOverBudget(ctx: AssetsCtx): void {
  const rows = heavyRows(ctx.state).toSorted(
    (left, right) => right.mb - left.mb || left.key.localeCompare(right.key)
  );

  ctx.log.warn("assets: over the texture budget with nothing to unload", {
    usedMb: Number(usedMb(ctx.state).toFixed(3)),
    budgetMb: ctx.config.textureBudgetMb,
    heaviest: rows.slice(0, HEAVIEST)
  });
}

/**
 * Unloads bundles until the budget holds again. It runs after every load and at every rest node.
 * Headless there is no texture memory, so it does nothing.
 *
 * @param ctx - Domain context of the plugin.
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

/**
 * Creates an empty set of names. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function emptyNames(): Set<string> {
  return new Set();
}

/**
 * Lists the features with a node on the flow stack: for every frame, the outer frames of a
 * sub-flow included, the owner `flow.describe()` gives the node the frame addresses. A node with
 * no owner adds nothing. Read once per release or preload pass.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The feature names.
 */
export function featuresOnStack(ctx: AssetsCtx): ReadonlySet<string> {
  const graph = ctx.deps.flow.describe();
  const features = emptyNames();

  for (const frame of ctx.deps.flow.state().stack) {
    const owner = graph.flows[frame.flow]?.nodes[frame.node]?.owner;

    if (owner !== undefined) features.add(owner);
  }

  return features;
}

/**
 * Tells whether a bundle must stay where the game stands now: it is pinned (a bundle of the node
 * entered last), the mounted scene names it (the last list `sceneBundles` received), a leaving
 * scene named it and its elements still play their exit, its feature is in `onStack`, or its tier
 * is permanent.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - Name of the bundle.
 * @param entry - Its manifest entry.
 * @param onStack - The features on the stack, from `featuresOnStack`.
 * @returns True when the bundle is held.
 */
export function isHeld(
  ctx: AssetsCtx,
  name: string,
  entry: ManifestBundle,
  onStack: ReadonlySet<string>
): boolean {
  const state = ctx.state;

  return (
    state.pinned.has(name) ||
    state.sceneNamed.includes(name) ||
    state.sceneLeaving.includes(name) ||
    onStack.has(entry.feature) ||
    isPermanent(entry.tier)
  );
}

/**
 * Unloads every loaded `"leave"` bundle nobody holds any more, with the reason `"leave"`; a
 * leaving scene holds its bundles only while anything carries `Exiting`. A running load is never aborted by it, and a `"budget"` bundle is never touched. Headless it does
 * nothing.
 *
 * @param ctx - Domain context of the plugin.
 */
export function releaseLeftBundles(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.io === undefined) return;
  // A leaving scene whose elements all played their exit holds nothing any more.
  if (state.sceneLeaving.length > 0 && !anyExiting(ctx)) state.sceneLeaving = [];

  const onStack = featuresOnStack(ctx);

  for (const [name, record] of state.records) {
    const entry = state.manifest.bundles[name];

    if (record.status !== "loaded" || entry?.release !== "leave") continue;
    if (isHeld(ctx, name, entry, onStack)) continue;

    unloadBundle(ctx, name, "leave");
  }
}

/**
 * Takes the list the mounted scene names now. A bundle the list named before and names no more
 * stays held as a leaving scene's, until nothing carries `Exiting` (F51); a name the list takes
 * again is the mounted scene's once more.
 *
 * @param state - The plugin state.
 * @param named - The bundles the mounted scene names now.
 * @example
 * ```ts
 * // The memory named ep01.memory; the board names nothing of it.
 * nameSceneBundles(state, ["board"]); // state.sceneLeaving: ["ep01.memory", "ui.memory"]
 * ```
 */
export function nameSceneBundles(state: State, named: readonly string[]): void {
  const leaving = state.sceneLeaving.filter(name => !named.includes(name));

  for (const name of state.sceneNamed) {
    if (!named.includes(name) && !leaving.includes(name)) leaving.push(name);
  }

  state.sceneLeaving = leaving;
  state.sceneNamed = [...named];
}

/**
 * Tells whether an element of the world still plays its exit.
 *
 * @param ctx - Domain context of the plugin.
 * @returns True while anything carries `Exiting`.
 */
function anyExiting(ctx: AssetsCtx): boolean {
  // The first row answers: a `for…of` that returns at once walks no further.
  for (const row of ctx.deps.world.ecs.query(Exiting)) if (row.length > 0) return true;

  return false;
}

/**
 * Lets the bundles a leaving scene named go once nothing carries `Exiting` any more: each loaded
 * `"leave"` bundle among them that nothing else holds is unloaded with the reason `"leave"`, at
 * once, not at the next rest. A bundle of another release stays, as it would have. The world calls
 * it through `onRemoved(Exiting)`, so the check costs a length read while no scene leaves.
 *
 * @param ctx - Domain context of the plugin.
 */
export function releaseSceneLeft(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.sceneLeaving.length === 0 || anyExiting(ctx)) return;

  const names = state.sceneLeaving;

  state.sceneLeaving = [];

  if (state.io === undefined) return;

  const onStack = featuresOnStack(ctx);

  for (const name of names) {
    const entry = state.manifest.bundles[name];

    if (state.records.get(name)?.status !== "loaded" || entry?.release !== "leave") continue;
    if (isHeld(ctx, name, entry, onStack)) continue;

    unloadBundle(ctx, name, "leave");
  }
}
