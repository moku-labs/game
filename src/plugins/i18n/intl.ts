/**
 * @file i18n plugin — the memoised `Intl.*` formatters of one locale. A compiled message asks
 * the kit for the formatter it needs; nothing in the engine constructs an `Intl.*` object twice
 * for the same options, which is what keeps a per-frame text sync cheap.
 */
import type { IntlKit } from "./types";

/**
 * The memo key of one options object. `undefined` and `{}` are the same formatter.
 *
 * @param options - What the compiled message asked for.
 * @returns The key to memoise under.
 * @example
 * ```ts
 * keyOf({ style: "percent" }); // '{"style":"percent"}'
 * ```
 */
function keyOf(options: object | undefined): string {
  return options === undefined ? "" : JSON.stringify(options);
}

/**
 * Answers the memoised formatter for one options object, building it on first use.
 *
 * @param cache - Where the formatters of this kind are kept.
 * @param options - What the compiled message asked for.
 * @param build - How to build the formatter.
 * @returns The formatter.
 */
function memo<Formatter>(
  cache: Map<string, Formatter>,
  options: object | undefined,
  build: () => Formatter
): Formatter {
  const key = keyOf(options);
  const known = cache.get(key);

  if (known !== undefined) return known;

  const made = build();

  cache.set(key, made);

  return made;
}

/**
 * Creates the table one kind of formatter is memoised in. Its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty table.
 */
function emptyCache<Formatter>(): Map<string, Formatter> {
  return new Map();
}

/**
 * Creates the formatter kit of one locale. Every kit is built once, on first use of its locale,
 * and kept in `state.intl`.
 *
 * @param locale - The locale every formatter is built for.
 * @returns The kit a compiled message is handed.
 * @example
 * ```ts
 * const intl = createIntlKit("ru");
 * intl.plural().select(5); // "many"
 * intl.number().format(1234); // "1 234"
 * ```
 */
export function createIntlKit(locale: string): IntlKit {
  const plurals = emptyCache<Intl.PluralRules>();
  const numbers = emptyCache<Intl.NumberFormat>();
  const lists = emptyCache<Intl.ListFormat>();
  const dates = emptyCache<Intl.DateTimeFormat>();

  return {
    locale,
    plural: options => memo(plurals, options, () => new Intl.PluralRules(locale, options)),
    number: options => memo(numbers, options, () => new Intl.NumberFormat(locale, options)),
    list: options => memo(lists, options, () => new Intl.ListFormat(locale, options)),
    date: options => memo(dates, options, () => new Intl.DateTimeFormat(locale, options))
  };
}
