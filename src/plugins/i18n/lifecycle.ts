/**
 * @file i18n plugin — lifecycle: the compiled modules read out of the feature descriptions and
 * the config in `onStart`, the merge of every eager locale, and the one loader run that makes
 * `format` synchronous for the start locale and the fallback. There is no `onStop`: the maps die
 * with the app.
 */
import { flowPlugin } from "../flow";
import { mergeLocales } from "./messages";
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
 * Tells whether a value is a module namespace, the shape `() => import(…)` resolves with.
 *
 * @param value - What the loader returned.
 * @returns True when the messages sit under `default`.
 */
function hasDefault(value: unknown): value is { default: unknown } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Reads the compiled messages out of what a feature or a loader brought. A module namespace is
 * unwrapped to its `default`; everything else is the table itself. This is the one place the
 * opaque value `flow` carried becomes the shape `compileStrings` wrote.
 *
 * @param value - The module, or the namespace around it.
 * @returns The compiled messages.
 */
function messagesOf(value: unknown): CompiledMessages {
  return (hasDefault(value) ? value.default : value) as CompiledMessages;
}

/**
 * Tells whether a registered module is ready to be merged, or still a loader.
 *
 * @param entry - The registered module.
 * @returns True when the messages are there already.
 */
function isReady(entry: RegisteredModule): entry is ResolvedModule {
  return typeof entry.messages !== "function";
}

/**
 * Records one module under its locale, keeping the name it can be blamed under.
 *
 * @param state - The plugin state.
 * @param locale - The locale the module belongs to.
 * @param from - The feature that brought it, or the config.
 * @param value - The module, or the loader that fetches it.
 */
function register(state: State, locale: string, from: string, value: unknown): void {
  const entries = state.registered.get(locale) ?? [];

  if (typeof value === "function") {
    const load = value as () => Promise<unknown>;
    const loader: StringsLoader = async () => messagesOf(await load());

    entries.push({ from, messages: loader });
  } else entries.push({ from, messages: messagesOf(value) });

  state.registered.set(locale, entries);
}

/**
 * Reads the `strings` key of every registered feature and of the config into the registry.
 * Features register in their own `onInit`, which runs before this `onStart`, so every module of
 * the game is here.
 *
 * @param ctx - Kernel context of the i18n plugin.
 */
function collect(ctx: I18nCtx): void {
  for (const feature of ctx.require(flowPlugin).features.all()) {
    const { strings } = feature.description;

    if (strings === undefined) continue;

    for (const [locale, value] of Object.entries(strings)) {
      register(ctx.state, locale, feature.name, value);
    }
  }

  for (const [locale, value] of Object.entries(ctx.config.locales)) {
    register(ctx.state, locale, CONFIG_OWNER, value);
  }
}

/**
 * Merges every locale whose modules all arrived eagerly, so `format` answers without waiting.
 * A locale with a loader is merged when that loader runs.
 *
 * @param state - The plugin state.
 * @throws {Error} When two features carry the same key in one locale.
 */
function mergeEager(state: State): void {
  for (const [locale, entries] of state.registered) {
    const ready = entries.filter(entry => isReady(entry));

    if (ready.length === entries.length) state.loaded.set(locale, mergeLocales(ready));
  }
}

/**
 * Runs the loaders of one locale, once, and merges everything registered for it.
 *
 * @param state - The plugin state.
 * @param locale - The locale to load.
 * @returns A promise that settles when the locale is in `loaded`.
 * @throws {Error} When two features carry the same key, or a loader rejects.
 */
export async function loadLocale(state: State, locale: string): Promise<void> {
  if (state.loaded.has(locale)) return;

  const resolved: ResolvedModule[] = [];

  for (const entry of state.registered.get(locale) ?? []) {
    const brought = entry.messages;
    const messages = typeof brought === "function" ? messagesOf(await brought()) : brought;

    resolved.push({ from: entry.from, messages });
  }

  state.loaded.set(locale, mergeLocales(resolved));
}

/**
 * Collects every compiled module, merges the eager locales and resolves the start locale and the
 * fallback, so the first `format` never waits. A game that brought no strings at all starts with
 * an empty registry instead of failing: every key is then missing, and nothing else changes.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @returns A promise that settles when the start locale is loaded.
 * @throws {Error} When the start locale is not registered, or two features share a key.
 */
export async function startI18n(ctx: I18nCtx): Promise<void> {
  const { locale, fallback } = ctx.config;

  collect(ctx);
  mergeEager(ctx.state);

  if (ctx.state.registered.size > 0 && !ctx.state.registered.has(locale)) {
    throw notRegistered(locale);
  }

  if (ctx.state.registered.has(locale)) await loadLocale(ctx.state, locale);
  if (fallback !== locale && ctx.state.registered.has(fallback)) {
    await loadLocale(ctx.state, fallback);
  }

  ctx.state.locale = locale;
}
