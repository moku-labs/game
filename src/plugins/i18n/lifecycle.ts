/**
 * @file i18n plugin — lifecycle: the compiled modules read out of the feature descriptions and
 * the config in `onStart`, the coupling of a sub-feature's lazy modules to its bundle, the merge
 * of every eager locale, and the one loader run that makes `format` synchronous for the start
 * locale and the fallback. There is no `onStop`: the maps die with the app.
 */
import { flowPlugin } from "../flow";
import { bundleOf, holdLoaded, ignore, runAfter } from "./bundles";
import { mergeOf, messagesOf } from "./messages";
import type {
  CompiledMessages,
  I18nCtx,
  RegisteredModule,
  ResolvedModule,
  State,
  StringsLoader
} from "./types";

/** What a module brought by `pluginConfigs.i18n.locales` is blamed under. */
const CONFIG_OWNER = "pluginConfigs.i18n";

/**
 * Wraps an unknown locale in the message shape of the framework.
 *
 * @param locale - The locale nobody registered.
 * @returns The error to throw.
 */
export function notRegistered(locale: string): Error {
  return new Error(
    `[game] Locale "${locale}" is not registered.\n` +
      "  Add it to pluginConfigs.i18n.locales or the feature strings."
  );
}

/**
 * Wraps a registered locale whose loader has not run in the message shape of the framework.
 *
 * @param locale - The locale that is registered but not loaded.
 * @returns The error to throw.
 */
export function notLoaded(locale: string): Error {
  return new Error(
    `[game] Locale "${locale}" is not loaded.\n` +
      `  Await setLocale("${locale}") once, or register it eagerly.`
  );
}

/**
 * Tells whether a registered module is ready to be merged, or still a loader.
 *
 * @param entry - The registered module.
 * @returns True when the messages are there already.
 */
export function isReady(entry: RegisteredModule): entry is ResolvedModule {
  return typeof entry.messages !== "function";
}

/**
 * Tells a lazy strings module, a loader that fetches it, from the module itself.
 *
 * @param value - The module, or the loader that fetches it.
 * @returns True for a function.
 * @example
 * ```ts
 * isLoader(async () => ({ "hud.orders": "Orders" })); // true
 * ```
 */
function isLoader(value: unknown): value is () => Promise<unknown> {
  return typeof value === "function";
}

/**
 * Records one module under its locale, keeping the name it can be blamed under. A loader of a
 * coupled sub-feature also keeps the bundle it lives with.
 *
 * @param state - The plugin state.
 * @param locale - The locale the module belongs to.
 * @param from - The feature that brought it, or the config.
 * @param value - The module, or the loader that fetches it.
 * @param bundle - The bundle a coupled loader lives with; absent for every other module.
 */
function register(
  state: State,
  locale: string,
  from: string,
  value: unknown,
  bundle?: string
): void {
  const entries = state.registered.get(locale) ?? [];

  if (isLoader(value)) {
    const loader: StringsLoader = async () => messagesOf(await value());

    entries.push(
      bundle === undefined ? { from, messages: loader } : { from, messages: loader, bundle }
    );
  } else entries.push({ from, messages: messagesOf(value) });

  state.registered.set(locale, entries);
}

/**
 * Reads the `strings` key of every registered feature and of the config into the registry, and
 * marks the plugin started. Features register in their own `onInit`, which runs before this
 * `onStart`, so every module of the game is here. A sub-feature's loader is coupled to the bundle
 * of its name when the manifest has one; an eager table and the config's modules never are.
 *
 * @param ctx - Kernel context of the i18n plugin.
 */
function collect(ctx: I18nCtx): void {
  for (const feature of ctx.require(flowPlugin).features.all()) {
    const { strings } = feature.description;

    if (strings === undefined) continue;

    const bundle = bundleOf(ctx, feature);

    for (const [locale, value] of Object.entries(strings)) {
      const coupled = bundle !== undefined && isLoader(value) ? bundle : undefined;

      register(ctx.state, locale, feature.name, value, coupled);
      if (coupled !== undefined) ctx.state.coupled.add(coupled);
    }
  }

  for (const [locale, value] of Object.entries(ctx.config.locales)) {
    register(ctx.state, locale, CONFIG_OWNER, value);
  }

  ctx.state.started = true;
}

/**
 * Merges every locale whose modules that must be in memory all arrived eagerly, so `format`
 * answers without waiting. A coupled module must be in memory only while its bundle is held; a
 * locale with a loader that must run is merged when that loader runs.
 *
 * @param state - The plugin state.
 * @throws {Error} When two features carry the same key in one locale.
 */
function mergeEager(state: State): void {
  for (const [locale, entries] of state.registered) {
    const waiting = entries.some(
      entry => !isReady(entry) && (entry.bundle === undefined || state.held.has(entry.bundle))
    );

    if (!waiting) state.loaded.set(locale, mergeOf(state, locale));
  }
}

/**
 * Answers the modules of one held bundle, creating its table on first use.
 *
 * @param state - The plugin state.
 * @param bundle - The held bundle.
 * @returns Locale to the bundle's module.
 */
function modulesOf(state: State, bundle: string): Map<string, CompiledMessages> {
  const known = state.bundled.get(bundle);

  if (known !== undefined) return known;

  const modules = new Map<string, CompiledMessages>();

  state.bundled.set(bundle, modules);

  return modules;
}

/**
 * Imports the module of a held bundle for one locale, once. The module is kept only when the
 * load that held the bundle is still the one in place: an unload while the loader ran wins.
 *
 * @param state - The plugin state.
 * @param entry - The coupled entry of the locale.
 * @param bundle - The bundle the entry lives with.
 * @param locale - The locale to load.
 * @returns A promise that settles when the module is stored, or dropped.
 */
async function bringHeld(
  state: State,
  entry: RegisteredModule,
  bundle: string,
  locale: string
): Promise<void> {
  const token = state.held.get(bundle);
  const loader = entry.messages;

  if (token === undefined || typeof loader !== "function") return;
  if (state.bundled.get(bundle)?.has(locale) === true) return;

  const messages = messagesOf(await loader());

  if (state.held.get(bundle) === token) modulesOf(state, bundle).set(locale, messages);
}

/**
 * Runs the loaders of one locale, once, and merges everything that must be in memory for it. The
 * resolved modules replace the loaders in the registry, so `replace` finds the keys of a lazy
 * locale too. A coupled loader runs only while its bundle is held, and keeps its place in the
 * registry: its module goes to `bundled`.
 *
 * @param state - The plugin state.
 * @param locale - The locale to load.
 * @returns A promise that settles when the locale is in `loaded`.
 * @throws {Error} When two features carry the same key, or a loader rejects.
 */
export async function loadLocale(state: State, locale: string): Promise<void> {
  if (state.loaded.has(locale)) return;

  const next: RegisteredModule[] = [];

  for (const entry of state.registered.get(locale) ?? []) {
    const brought = entry.messages;

    if (entry.bundle !== undefined) {
      await bringHeld(state, entry, entry.bundle, locale);
      next.push(entry);
    } else if (typeof brought === "function") {
      next.push({ from: entry.from, messages: messagesOf(await brought()) });
    } else next.push(entry);
  }

  const merged = mergeOf(state, locale, next);

  state.registered.set(locale, next);
  state.loaded.set(locale, merged);
}

/**
 * Gives every bundle held through the start loads a table in `bundled`, an empty one when its
 * feature brought nothing for the loaded locales, so a key of it is never called "not loaded".
 * A bundle unloaded, or loaded again, while the start ran is left to its own load.
 *
 * @param state - The plugin state.
 * @param taken - The bundles held when the start loads began, with their tokens.
 */
function keepHeld(state: State, taken: ReadonlyMap<string, symbol>): void {
  for (const [bundle, token] of taken) {
    if (state.held.get(bundle) === token) modulesOf(state, bundle);
  }
}

/**
 * Collects every compiled module, takes the bundles `assets` already holds, merges the eager
 * locales and resolves the start locale and the fallback on the queue, so the first `format`
 * never waits and a bundle load that arrives meanwhile runs after them. A game that brought no
 * strings at all starts with an empty registry instead of failing: every key is then missing,
 * and nothing else changes.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @returns A promise that settles when the start locale is loaded.
 * @throws {Error} When the start locale is not registered, or two features share a key.
 */
export async function startI18n(ctx: I18nCtx): Promise<void> {
  const { state } = ctx;
  const { locale, fallback } = ctx.config;

  collect(ctx);
  holdLoaded(ctx);
  mergeEager(state);

  if (state.registered.size > 0 && !state.registered.has(locale)) {
    throw notRegistered(locale);
  }

  const taken = new Map(state.held);
  const chain = runAfter(state.loading, async () => {
    if (state.registered.has(locale)) await loadLocale(state, locale);
    if (fallback !== locale && state.registered.has(fallback)) await loadLocale(state, fallback);

    keepHeld(state, taken);
    state.locale = locale;
  });

  state.loading = chain.then(ignore, ignore);

  await chain;
}
