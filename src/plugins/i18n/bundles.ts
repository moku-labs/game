/**
 * @file i18n plugin — the strings that live with a bundle: the companion `assets` calls when a
 * bundle loads and unloads, and the queue every strings load runs on. The lazy module of a
 * sub-feature whose bundle the manifest has is coupled to that bundle: it is imported when assets
 * loads the bundle and dropped when assets unloads it. `assets` is an optional partner, reached
 * only after `ctx.has("assets")`; `i18n` does not depend on it.
 */
import { assetsPlugin } from "../assets";
import type { RegisteredFeature } from "../flow/types";
import { mergeOf, messagesOf } from "./messages";
import type { CompiledMessages, I18nCtx, State, StringsLoader } from "./types";

/**
 * Runs one strings load after the one already in flight, so a locale load and a bundle load
 * never interleave and the last call wins.
 *
 * @param previous - The load in flight, if there is one.
 * @param task - The load to run next.
 * @returns The promise of the new load.
 */
export function runAfter(
  previous: Promise<void> | undefined,
  task: () => Promise<void>
): Promise<void> {
  return previous === undefined ? task() : previous.then(task);
}

/**
 * Swallows the outcome of a load, so the promise a later caller waits on never rejects.
 */
export function ignore(): void {
  // Nothing to do: the outcome is read by the caller that started the load.
}

/**
 * Answers the bundle a feature's lazy strings live with: its own name, for a sub-feature whose
 * bundle the manifest has, when `assets` is composed. A top-level feature never asks `assets`.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param feature - One entry of the feature registry.
 * @returns The bundle name, or `undefined` when the strings load with their locale.
 */
export function bundleOf(ctx: I18nCtx, feature: RegisteredFeature): string | undefined {
  if (feature.parent === undefined || !ctx.has("assets")) return undefined;

  return ctx.require(assetsPlugin).has(feature.name) ? feature.name : undefined;
}

/**
 * Keeps only the coupled bundles among the loads recorded before start, and takes the coupled
 * bundles `assets` already holds: headless every manifest bundle counts as loaded and no
 * companion call comes, and a bundle can finish loading before this `onStart`.
 *
 * @param ctx - Kernel context of the i18n plugin.
 */
export function holdLoaded(ctx: I18nCtx): void {
  const { state } = ctx;

  for (const bundle of state.held.keys()) {
    if (!state.coupled.has(bundle)) state.held.delete(bundle);
  }

  if (state.coupled.size === 0) return;

  const assets = ctx.require(assetsPlugin);

  for (const bundle of state.coupled) {
    if (!state.held.has(bundle) && assets.isLoaded(bundle)) state.held.set(bundle, Symbol(bundle));
  }
}

/**
 * The bundle a key waits for: its first segment while that sub-feature's strings are coupled and
 * not loaded. This is why a sub-feature's keys start with its name.
 *
 * @param state - The i18n state.
 * @param key - A string key.
 * @returns The bundle name, or `undefined` for a key of no coupled bundle, or of a loaded one.
 */
export function bundleOfKey(state: State, key: string): string | undefined {
  const dot = key.indexOf(".");

  if (dot < 1) return undefined;

  const name = key.slice(0, dot);

  return state.coupled.has(name) && !state.bundled.has(name) ? name : undefined;
}

/**
 * Answers the loader a coupled bundle registered for one locale.
 *
 * @param state - The i18n state.
 * @param bundle - The coupled bundle.
 * @param locale - The locale.
 * @returns The loader, or `undefined` when the feature brought no module for the locale.
 */
function loaderOf(state: State, bundle: string, locale: string): StringsLoader | undefined {
  const messages = state.registered.get(locale)?.find(entry => entry.bundle === bundle)?.messages;

  return typeof messages === "function" ? messages : undefined;
}

/**
 * Puts the modules of a bundle in place and merges every locale they touch. Every merge is
 * computed before any is written, so a duplicate key throws and nothing changes.
 *
 * @param state - The i18n state.
 * @param bundle - The bundle whose modules arrived.
 * @param next - Locale to the bundle's module.
 * @throws {Error} When a module of the bundle repeats a key of another feature.
 */
function commit(state: State, bundle: string, next: Map<string, CompiledMessages>): void {
  const before = state.bundled.get(bundle);
  const touched = [...new Set([...next.keys(), ...(before?.keys() ?? [])])].filter(locale =>
    state.loaded.has(locale)
  );

  state.bundled.set(bundle, next);

  try {
    const merged = touched.map(locale => ({ locale, table: mergeOf(state, locale) }));

    for (const { locale, table } of merged) state.loaded.set(locale, table);
  } catch (error) {
    if (before === undefined) state.bundled.delete(bundle);
    else state.bundled.set(bundle, before);

    throw error;
  }
}

/**
 * Tells `text` to resolve its labels again when the bundle brought a key already shown missing in
 * the current locale or the fallback. Those keys may warn again later.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param next - Locale to the bundle's module.
 */
function announce(ctx: I18nCtx, next: Map<string, CompiledMessages>): void {
  const { state } = ctx;
  const brought = [state.locale, ctx.config.fallback].flatMap(locale =>
    Object.keys(next.get(locale) ?? {})
  );
  const cleared = brought.filter(key => state.warned.delete(key));

  if (cleared.length > 0) ctx.emit("i18n:locale-changed", { locale: state.locale });
}

/**
 * Drops the strings of a bundle `assets` released: every locale that carried them is merged
 * again without them. No event: a label that shows a dropped text keeps it until its next
 * resolve, on a screen nobody names any more.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param bundle - The bundle that was unloaded, or whose load broke.
 */
function dropBundleStrings(ctx: I18nCtx, bundle: string): void {
  const { state } = ctx;
  const modules = state.bundled.get(bundle);

  state.held.delete(bundle);

  if (modules === undefined) return;

  state.bundled.delete(bundle);

  for (const locale of modules.keys()) {
    if (state.loaded.has(locale)) state.loaded.set(locale, mergeOf(state, locale));
  }
}

/**
 * Imports a bundle's module for every loaded locale and merges it in, unless an unload or a newer
 * load of the bundle won while the loaders ran. Runs on the queue.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param bundle - The coupled bundle.
 * @param token - The token of the load that started this task.
 * @returns A promise that settles when the modules are merged, or dropped.
 * @throws {Error} When a loader rejects, or a module repeats a key of another feature.
 */
async function bringBundle(ctx: I18nCtx, bundle: string, token: symbol): Promise<void> {
  const { state } = ctx;

  if (state.held.get(bundle) !== token) return;

  const next = new Map<string, CompiledMessages>();

  try {
    for (const locale of state.loaded.keys()) {
      const loader = loaderOf(state, bundle, locale);

      if (loader !== undefined) next.set(locale, messagesOf(await loader()));
    }

    if (state.held.get(bundle) !== token) return;

    commit(state, bundle, next);
  } catch (error) {
    if (state.held.get(bundle) === token) dropBundleStrings(ctx, bundle);

    throw error;
  }

  announce(ctx, next);
}

/**
 * The `load` of the companion: records the bundle, and after start imports its strings on the
 * queue. Before start it resolves at once, because `assets` boots its tiers before this plugin's
 * `onStart`, which then loads every held bundle with the start locale. A bundle without coupled
 * strings resolves at once and is not tracked.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param bundle - The bundle `assets` is loading.
 * @returns A promise that settles when the strings of every loaded locale are merged.
 * @throws {Error} When a loader rejects, or a module repeats a key of another feature.
 */
async function loadBundleStrings(ctx: I18nCtx, bundle: string): Promise<void> {
  const { state } = ctx;
  const token = Symbol(bundle);

  state.held.set(bundle, token);

  if (!state.started) return;

  if (!state.coupled.has(bundle)) {
    state.held.delete(bundle);
    return;
  }

  const chain = runAfter(state.loading, () => bringBundle(ctx, bundle, token));

  state.loading = chain.then(ignore, ignore);

  await chain;
}

/**
 * Registers the strings companion with `assets` in `onInit`, only when `assets` is composed: no
 * `depends` edge, so an app without `assets` keeps working and couples nothing.
 *
 * @param ctx - Kernel context of the i18n plugin.
 */
export function connectI18n(ctx: I18nCtx): void {
  if (!ctx.has("assets")) return;

  ctx.require(assetsPlugin).companions.add({
    load: bundle => loadBundleStrings(ctx, bundle),
    unload: bundle => {
      dropBundleStrings(ctx, bundle);
    }
  });
}
