/**
 * @file i18n plugin — the public API factory: the current locale, the switch that loads a module
 * and sends the one event, and the two `format` forms every label goes through. This is the only
 * place in the engine where a locale is read.
 */
import { createIntlKit } from "./intl";
import { loadLocale, notLoaded, notRegistered } from "./lifecycle";
import { mergeParts, missingParts, resolve } from "./messages";
import type { EmitLocaleChanged, I18nApi, I18nCtx, IntlKit, Message, Part, State } from "./types";

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

    // The one narrowing of the plugin: see the note on `I18nCtx`. Only `emit` is cast.
    const emit = ctx.emit as EmitLocaleChanged;

    emit("i18n:locale-changed", { locale });
  });

  ctx.state.loading = chain.then(ignore, ignore);

  await chain;
}

/**
 * Builds the API of the plugin.
 *
 * @param ctx - Kernel context of the i18n plugin.
 * @returns The six members of `app.i18n`.
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
    locales: () => [...ctx.state.registered.keys()].toSorted()
  };
}
