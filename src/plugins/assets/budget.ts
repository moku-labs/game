/**
 * @file assets plugin — texture memory: what is used, who leaves next and the eviction itself,
 * the release of a `"leave"` bundle whose feature left, and the release of a bundle nothing drew for
 * `releaseUndrawnS`. The LRU compares the use counter, never a clock.
 */

import { unloadCompanions } from "./companions";
import { isPermanent } from "./tiers";
import type {
  AssetsCtx,
  AssetsIo,
  BundleRecord,
  Events,
  LoadedAssets,
  ManifestBundle,
  State
} from "./types";

/** How many of the heaviest entries the over-budget warning names. */
const HEAVIEST = 5;

/** No feature holds a bundle: the stack as a leaving scene's non-`feature` bundle sees it. */
const NO_FEATURES: ReadonlySet<string> = Object.freeze(new Set<string>());

/** The key list of a bundle the manifest walk did not list: nothing drawn, nothing to invalidate. */
const NO_KEYS: readonly string[] = Object.freeze([]);

/** Where the pass keeps the frame time in `state.undrawnPass.clock`. */
const PASS_NOW = 0;

/** Where the pass keeps the milliseconds a bundle must go undrawn in `state.undrawnPass.clock`. */
const PASS_LIMIT = 1;

/** The time between two checks of `releaseUndrawnS`, in milliseconds of the frame clock. */
const CHECK_EVERY_MS = 1000;

/** Milliseconds in a second: `releaseUndrawnS` is in seconds, the frame clock in milliseconds. */
const MS_PER_SECOND = 1000;

/**
 * The least a bundle goes undrawn before the pass takes it: a check, then one a second later. So `releaseUndrawnS: 0`
 * never frees what the first step of a `load` effect just brought before the next step can draw it.
 */
const MIN_UNDRAWN_MS = 1000;

/** One row of the over-budget warning: a loose file by its key, or a page as `page "<id>"`. */
type Heavy = { key: string; mb: number };

/** Why a bundle was unloaded: the budget, a caller, its feature left, or nothing drew it for `releaseUndrawnS`. */
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
 * Reads the asset keys of a bundle from the list the manifest walk froze; a bundle it did not list
 * has none. Nothing is built per call.
 *
 * @param state - The plugin state.
 * @param bundle - Name of the bundle.
 * @returns Its keys, frozen.
 */
export function bundleKeys(state: State, bundle: string): readonly string[] {
  return state.keysOf.get(bundle) ?? NO_KEYS;
}

/**
 * Tells whether the budget must leave a loaded bundle alone by the state alone: pinned, permanent, named by the
 * mounted, a leaving or the coming scene, in the preload queue, held after a reload, rested on through `ready`, or the
 * `except` of the pass.
 *
 * @param state - The plugin state.
 * @param name - Name of the bundle.
 * @param entry - Its manifest entry.
 * @param except - The bundle whose load started the pass, if any.
 * @returns True when it may not go.
 */
function keptByState(state: State, name: string, entry: ManifestBundle, except?: string): boolean {
  return (
    name === except ||
    state.pinned.has(name) ||
    isPermanent(entry.tier) ||
    state.reloadHeld.has(name) ||
    state.readyWaiting.has(name) ||
    state.sceneNamed.includes(name) ||
    state.sceneLeaving.includes(name) ||
    state.sceneComing.includes(name) ||
    state.queue?.bundles.includes(name) === true
  );
}

/**
 * Picks the bundle that leaves next: the loaded one with the smallest use counter that is not
 * pinned, not named by the mounted, a leaving or the coming scene, not permanent, not in the preload queue, not held
 * after a reload, not rested on through `ready`, not `except` and drawn by no view (`renderer.sync.textures.used`, asked last: it walks the keys).
 * Its `release` is not read: a `"leave"` bundle is a candidate like any other.
 *
 * @param ctx - Domain context of the plugin.
 * @param except - The bundle that may not go: the one whose load started this pass.
 * @returns The bundle name, or `undefined` when nothing may go.
 */
export function pickVictim(ctx: AssetsCtx, except?: string): string | undefined {
  const state = ctx.state;
  const textures = ctx.deps.renderer.sync.textures;
  let victim: string | undefined;
  let smallest = Number.POSITIVE_INFINITY;

  for (const [name, record] of state.records) {
    const entry = state.manifest.bundles[name];

    if (record.status !== "loaded" || entry === undefined) continue;
    if (keptByState(state, name, entry, except)) continue;
    if (record.lastUsed >= smallest) continue;
    // A drawn bundle never goes: its views would ask again at once and the reload evict the next one (F184).
    if (textures.used(bundleKeys(state, name))) continue;

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
 * Notes why a bundle went, for the loop guard: a budget unload is remembered until the next rest, an undrawn unload until
 * the bundle loads again, so a view that asks again for it starts its hold; any other reason ends both marks and the
 * hold (F184, F198).
 *
 * @param state - The plugin state.
 * @param bundle - Name of the bundle.
 * @param reason - Why it was unloaded.
 */
function noteUnload(state: State, bundle: string, reason: UnloadReason): void {
  if (reason === "budget") {
    state.budgetUnloaded.add(bundle);

    return;
  }

  state.budgetUnloaded.delete(bundle);
  state.reloadHeld.delete(bundle);

  if (reason === "undrawn") state.undrawnUnloaded.add(bundle);
  else state.undrawnUnloaded.delete(bundle);
}

/**
 * Frees one loaded bundle: the textures are destroyed, its warm is forgotten, every companion drops
 * what travels with it, the loop guard notes the reason, `renderer` is told that its keys are gone and the event goes
 * out. A bundle that is not loaded is left alone.
 *
 * @param ctx - Domain context of the plugin.
 * @param bundle - Name of the bundle.
 * @param reason - Whether the budget, a caller, the release of a left feature or the release of an undrawn bundle asked
 *   for it.
 */
export function unloadBundle(ctx: AssetsCtx, bundle: string, reason: UnloadReason): void {
  const state = ctx.state;
  const record = state.records.get(bundle);
  const entry = state.manifest.bundles[bundle];

  if (record === undefined || entry === undefined || record.status !== "loaded") return;

  releaseAssets(state.io, record);

  record.status = "idle";
  record.lastUsed = 0;
  record.undrawnSince = -1;
  // Its textures are gone from the GPU: a reload warms again (F60).
  state.warmed.delete(bundle);

  unloadCompanions(ctx, state.companions, bundle);
  noteUnload(state, bundle, reason);

  const keys = bundleKeys(state, bundle);

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
 * @param except - The bundle a load just published: never undone by its own pass. A rest passes none.
 */
export function enforceBudget(ctx: AssetsCtx, except?: string): void {
  const state = ctx.state;

  if (state.io === undefined) return;

  while (usedMb(state) > ctx.config.textureBudgetMb) {
    const victim = pickVictim(ctx, except);

    if (victim === undefined) {
      warnOverBudget(ctx);

      return;
    }

    unloadBundle(ctx, victim, "budget");
  }
}

/**
 * Lists the features with a node on the flow stack: for every frame, the outer frames of a
 * sub-flow included, the owner `flow.describe()` gives the node the frame addresses. A node with
 * no owner adds nothing. Read once per release or preload pass, into the one set of the plugin state, filled again
 * only when the stack or the graph is another (F196): the answer holds until the next call.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The feature names.
 */
export function featuresOnStack(ctx: AssetsCtx): ReadonlySet<string> {
  const state = ctx.state;
  const stack = ctx.deps.flow.state().stack;
  const graph = ctx.deps.flow.describe();
  const features = state.stackFeatures;

  // The same stack and graph: the set holds. A `clear` frees the table and the next `add` builds it again.
  if (state.stackFeaturesOf?.stack === stack && state.stackFeaturesOf.graph === graph) {
    return features;
  }

  features.clear();
  state.stackFeaturesOf = { stack, graph };

  for (const frame of stack) {
    const owner = graph.flows[frame.flow]?.nodes[frame.node]?.owner;

    if (owner !== undefined) features.add(owner);
  }

  return features;
}

/**
 * Tells whether a bundle must stay where the game stands now: it is pinned (a bundle of the node
 * entered last), the mounted scene names it (the last list `sceneBundles` received), the scene
 * being built names it (the last list `sceneComing` received), a leaving scene named it and its
 * elements still play their exit, a node rests on it through `ready` (F190), its feature is in
 * `onStack`, or its tier is permanent.
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
    state.sceneComing.includes(name) ||
    state.readyWaiting.has(name) ||
    onStack.has(entry.feature) ||
    isPermanent(entry.tier)
  );
}

/**
 * Unloads every loaded `"leave"` bundle nobody holds any more, with the reason `"leave"`. A
 * leaving scene's bundles stay held: `releaseSceneLeft` lets them go, after the reconcile that
 * starts their exit (F51b). A running load is never aborted by it, and a `"budget"` bundle is never
 * touched. Headless it does nothing.
 *
 * @param ctx - Domain context of the plugin.
 */
export function releaseLeftBundles(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.io === undefined) return;

  const onStack = featuresOnStack(ctx);

  for (const name of state.records.keys()) unloadIfLeft(ctx, name, onStack);
}

/**
 * Takes the list the mounted scene names now. A bundle the list named before and names no more
 * stays held as a leaving scene's, until nothing carries `Exiting` (F51); a name the list takes
 * again is the mounted scene's once more. The coming list empties: its scene is the mounted one.
 *
 * @param state - The plugin state.
 * @param named - The bundles the mounted scene names now.
 */
export function nameSceneBundles(state: State, named: readonly string[]): void {
  // A name the new list drops stays held as a leaving scene's; one it takes back is not leaving.
  const leaving = state.sceneLeaving.filter(name => !named.includes(name));

  for (const name of state.sceneNamed) {
    if (!named.includes(name) && !leaving.includes(name)) leaving.push(name);
  }

  // The new list is the mounted scene's; the scene that was coming is mounted now.
  state.sceneLeaving = leaving;
  state.sceneNamed = [...named];
  state.sceneComing = [];
}

/**
 * Takes the list the scene being built aside names: each call replaces the one before, and `[]`
 * ends the hold of a discarded build. `nameSceneBundles` empties it at the swap (F61 S2).
 *
 * @param state - The plugin state.
 * @param named - The bundles the coming scene names.
 */
export function nameComingBundles(state: State, named: readonly string[]): void {
  state.sceneComing = [...named];
}

/**
 * Lets the bundles a leaving scene named go once nothing carries `Exiting` any more: each loaded
 * `"leave"` bundle among them that nothing else holds is unloaded with the reason `"leave"`, at
 * once, not at the next rest. Its feature on the stack holds only a `feature`-tier bundle, which
 * lives with its feature's flow: a scene's bundle goes with the scene, also while another scene of
 * its feature shows (the splash's 7.5 MiB under the ward). A bundle of another release stays, as
 * it would have. The system `assets.leave` calls it in every phase `sync`: after the reconcile of
 * `layout`, which tags the leaving elements `Exiting` in the frame after the switch, so the hold
 * never ends before the leave begins (F51b). While a scene is built aside (the coming list is
 * set; a scene names its own bundle, so the list of a build is never empty) the leave has not
 * begun: the world holds the scene on screen as it stood until the swap, and what it draws still
 * needs its bundles. It costs two length reads while no scene leaves, and a count read while one
 * does.
 *
 * @param ctx - Domain context of the plugin.
 */
export function releaseSceneLeft(ctx: AssetsCtx): void {
  const state = ctx.state;

  // Nothing left, its elements still play their exit, or the scene that drops it has not begun to leave.
  if (state.sceneLeaving.length === 0 || state.exiting > 0 || state.sceneComing.length > 0) return;

  const names = state.sceneLeaving;

  state.sceneLeaving = [];

  if (state.io === undefined) return;

  // Only a `feature`-tier bundle lives with its feature on the stack; a scene's goes with the scene.
  const onStack = featuresOnStack(ctx);

  for (const name of names) {
    const tier = state.manifest.bundles[name]?.tier;

    unloadIfLeft(ctx, name, tier === "feature" ? onStack : NO_FEATURES);
  }
}

/**
 * Unloads one bundle with the reason `"leave"` when it is a loaded `"leave"` bundle nobody holds.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - Name of the bundle.
 * @param onStack - The features on the stack, from `featuresOnStack`.
 */
function unloadIfLeft(ctx: AssetsCtx, name: string, onStack: ReadonlySet<string>): void {
  const entry = ctx.state.manifest.bundles[name];

  if (ctx.state.records.get(name)?.status !== "loaded" || entry?.release !== "leave") return;
  if (isHeld(ctx, name, entry, onStack)) return;

  unloadBundle(ctx, name, "leave");
}

/**
 * Tells whether the pass of `releaseUndrawnS` must leave a loaded bundle alone by the state alone: what the budget keeps
 * (`keptByState`), or a bundle the last look-ahead walk reached, which the next rest would load again.
 *
 * @param state - The plugin state.
 * @param name - Name of the bundle.
 * @param entry - Its manifest entry.
 * @returns True when it may not go.
 */
function keptFromUndrawn(state: State, name: string, entry: ManifestBundle): boolean {
  return keptByState(state, name, entry) || state.lookAhead?.ordered.includes(name) === true;
}

/**
 * The step of the pass of `releaseUndrawnS` for one record: a bundle with a sound or a font is skipped, a kept or a
 * drawn one stops its count, any other starts it, and one that went the limit undrawn is unloaded with the reason
 * `"undrawn"`. The pass hands the clock and the limit through `state.undrawnPass`.
 *
 * @param ctx - Domain context of the plugin.
 * @param record - The record of the bundle.
 * @param name - Name of the bundle.
 */
function visitUndrawn(ctx: AssetsCtx, record: BundleRecord, name: string): void {
  const state = ctx.state;
  const entry = state.manifest.bundles[name];

  if (record.status !== "loaded" || entry === undefined) return;
  // `textures.used` never sees these, and a miss on `audio()` or `font()` is silent: no hold, no reload. They leave by
  // the budget, `release: "leave"` and `unload`.
  if (record.audio.size > 0 || record.fonts.size > 0) return;

  const isKeptOrDrawn =
    keptFromUndrawn(state, name, entry) ||
    ctx.deps.renderer.sync.textures.used(bundleKeys(state, name));

  if (isKeptOrDrawn) {
    record.undrawnSince = -1;

    return;
  }

  const clock = state.undrawnPass.clock;
  const now = clock[PASS_NOW] ?? 0;

  if (record.undrawnSince === -1) record.undrawnSince = now;
  if (now - record.undrawnSince >= (clock[PASS_LIMIT] ?? 0)) unloadBundle(ctx, name, "undrawn");
}

/**
 * Makes the step of the pass once for a state: a function over `ctx`, so `forEach` takes it and a pass makes no closure.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The step `visitUndrawn` takes for each record.
 */
function undrawnStep(ctx: AssetsCtx): (record: BundleRecord, name: string) => void {
  return (record, name) => visitUndrawn(ctx, record, name);
}

/**
 * Unloads the loaded bundles nothing has drawn or kept for `releaseUndrawnS` game seconds, with the reason `"undrawn"`
 * (F198). The system `assets.leave` calls it every frame; it returns at once while the field is off, while headless,
 * while the flow walks fast and until the next check, which comes a second of the frame clock after the last. Only a
 * pass walks the records, and it allocates nothing. A bundle goes between `releaseUndrawnS` and one second more after
 * it stopped being drawn.
 *
 * @param ctx - Domain context of the plugin.
 * @param now - The frame clock in milliseconds: `ctx.time.elapsed` of the system, scaled game time.
 */
export function releaseUndrawn(ctx: AssetsCtx, now: number): void {
  const state = ctx.state;
  const seconds = ctx.config.releaseUndrawnS;

  if (seconds === undefined || state.io === undefined || now < state.undrawnCheckAt) return;
  // A fast walk shows nothing to anybody: nothing is freed there.
  if (ctx.deps.flow.state().mode === "fast") return;

  // The pass reads its clock and limit from a typed cell: a double stored in a plain field of the state is boxed.
  const pass = state.undrawnPass;

  state.undrawnCheckAt = now + CHECK_EVERY_MS;
  pass.clock[PASS_NOW] = now;
  pass.clock[PASS_LIMIT] = Math.max(seconds * MS_PER_SECOND, MIN_UNDRAWN_MS);
  // `forEach` with a step made once, not `for…of`: no iterator object and no closure per pass.
  pass.visit ??= undrawnStep(ctx);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a step made once
  state.records.forEach(pass.visit);
}
