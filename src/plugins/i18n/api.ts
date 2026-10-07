/**
 * @file i18n plugin — the public API factory: the current locale, the switch that loads a module
 * and sends the one event, the two `format` forms every label goes through, and the duration a
 * countdown reads, and the swap of one module the dev hot swap calls. This is the only place in the
 * engine where a locale is read.
 */
import { createIntlKit, messageDuration } from "./intl";
import { isReady, loadLocale, notLoaded, notRegistered } from "./lifecycle";
import { mergeLocales, mergeParts, missingParts, resolve } from "./messages";
import type {
  CompiledMessages,
  DurationStyle,
  I18nApi,
  I18nCtx,
  IntlKit,
  Message,
  Part,
  RegisteredModule,
  State
} from "./types";

/**
 * Answers the formatter kit of one locale, building it on first use.
 *
 * @param state - The plugin state.
 * @param locale - The locale to read.
 * @returns The kit a compiled message is handed.
 */
function kitOf(state: State, locale: string): IntlKit {
  const known = state.intl.get(locale);

  if (known !== undefined) return known;

  const kit = createIntlKit(locale);

  state.intl.set(locale, kit);

  return kit;
}

/**
 * Checks that another locale can be read right now.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param locale - The locale the caller asked for.
 * @returns The same locale.
 * @throws {Error} When the locale is not registered, or is registered but not loaded.
 */
function readable(ctx: I18nCtx, locale: string): string {
  if (!ctx.state.registered.has(locale)) throw notRegistered(locale);
  if (!ctx.state.loaded.has(locale)) throw notLoaded(locale);

  return locale;
}

/**
 * Reports a key no locale of the chain has, once over the app's life, and answers the parts that
 * show it on the screen.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param key - The message key.
 * @param locale - The locale that was read first.
 * @returns The parts of a missing key.
 */
function missing(ctx: I18nCtx, key: string, locale: string): readonly Part[] {
  if (!ctx.state.warned.has(key)) {
    ctx.state.warned.add(key);
    ctx.log.warn("i18n: missing key", { key, locale });
  }

  return missingParts(key);
}

/**
 * Formats one message in one locale, through the fallback chain.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param message - What `tr` returned.
 * @param locale - The locale to read first, or the current one.
 * @returns The parts of the sentence, adjacent text merged.
 * @throws {Error} When a named locale is not registered or not loaded.
 */
function formatIn(ctx: I18nCtx, message: Message, locale?: string): readonly Part[] {
  const target = locale === undefined ? ctx.state.locale : readable(ctx, locale);
  const compiled = resolve(ctx.state, message.key, target, ctx.config.fallback);

  if (compiled === undefined) return missing(ctx, message.key, target);

  return mergeParts(compiled(message.params ?? {}, kitOf(ctx.state, target)));
}

/**
 * Runs one locale switch after the one already in flight, so the last call wins.
 *
 * @param previous - The switch in flight, if there is one.
 * @param task - The switch to run next.
 * @returns The promise of the new switch.
 */
function runAfter(previous: Promise<void> | undefined, task: () => Promise<void>): Promise<void> {
  return previous === undefined ? task() : previous.then(task);
}

/**
 * Swallows the outcome of a switch, so the promise a later caller waits on never rejects.
 */
function ignore(): void {
  // Nothing to do: the outcome is read by the caller that started the switch.
}

/**
 * Switches the current locale: load what is lazy, set the locale, send the event.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param locale - The locale to switch to.
 * @returns A promise that settles when the messages of that locale are loaded.
 * @throws {Error} When the locale is not registered, or its loader rejects.
 */
async function setLocale(ctx: I18nCtx, locale: string): Promise<void> {
  if (!ctx.state.registered.has(locale)) throw notRegistered(locale);
  if (locale === ctx.state.locale) return;

  const chain = runAfter(ctx.state.loading, async () => {
    await loadLocale(ctx.state, locale);
    ctx.state.locale = locale;
    ctx.emit("i18n:locale-changed", { locale });
  });

  ctx.state.loading = chain.then(ignore, ignore);

  await chain;
}

/**
 * Wraps a module that matches no single registered module in the message shape of the framework.
 *
 * @param locale - The locale of the module.
 * @returns The error to throw.
 */
function noSingleModule(locale: string): Error {
  return new Error(
    `[game] Strings for "${locale}" match no single registered module.\n` +
      "  Replace them with the module of one feature, or reload the page."
  );
}

/**
 * Tells whether a registered module is resolved and carries at least one key of `messages`.
 *
 * @param entry - The registered module.
 * @param messages - The new module.
 * @returns True when the entry is the one `messages` replaces, or one of several.
 */
function overlaps(entry: RegisteredModule, messages: CompiledMessages): boolean {
  return isReady(entry) && Object.keys(entry.messages).some(key => Object.hasOwn(messages, key));
}

/**
 * Swaps the one registered module of a loaded locale whose keys overlap the new module, merges
 * the locale again and tells `text` when a label may read it.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @param locale - The locale of the new module.
 * @param messages - The new module.
 * @throws {Error} When no registered module, or more than one, shares a key with the new one.
 */
function replaceModule(ctx: I18nCtx, locale: string, messages: CompiledMessages): void {
  const { state } = ctx;

  if (!state.loaded.has(locale)) return;

  const entries = state.registered.get(locale) ?? [];
  const owners = entries.filter(entry => overlaps(entry, messages));
  const [owner] = owners;

  if (owner === undefined || owners.length > 1) throw noSingleModule(locale);

  const next = entries.map(entry => (entry === owner ? { from: owner.from, messages } : entry));
  const merged = mergeLocales(next.filter(entry => isReady(entry)));

  state.registered.set(locale, next);
  state.loaded.set(locale, merged);
  state.warned.clear();

  if (locale === state.locale || locale === ctx.config.fallback) {
    ctx.emit("i18n:locale-changed", { locale: state.locale });
  }
}

/**
 * Builds the API of the plugin.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @returns The eight members of `app.i18n`.
 */
export function createI18nApi(ctx: I18nCtx): I18nApi {
  return {
    locale: () => ctx.state.locale,
    setLocale: locale => setLocale(ctx, locale),
    format: (message: Message, locale?: string): readonly Part[] => formatIn(ctx, message, locale),
    plain: message =>
      formatIn(ctx, message)
        .map(part => (part.kind === "text" ? part.text : ""))
        .join(""),
    has: key => resolve(ctx.state, key, ctx.state.locale, ctx.config.fallback) !== undefined,
    duration: (ms: number, style: DurationStyle = "short"): string =>
      kitOf(ctx.state, ctx.state.locale)
        .duration({ style, secondsDisplay: "always" })
        .format(messageDuration(ms)),
    locales: () => [...ctx.state.registered.keys()].toSorted(),
    replace: (locale, messages) => replaceModule(ctx, locale, messages)
  };
}
