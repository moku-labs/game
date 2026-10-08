/**
 * @file i18n plugin — the memoised `Intl.*` formatters of one locale, and the two helpers a
 * compiled message calls: `messageArgument` for a plain argument and `messageDuration` for a
 * duration. A compiled message asks the kit for the formatter it needs; nothing in the engine
 * constructs an `Intl.*` object twice for the same options, which is what keeps a per-frame text
 * sync cheap. A generated `strings.<locale>.ts` imports the two helpers from the root.
 */
import type { ElementNode, IntlKit, Part } from "./types";

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

/** Milliseconds in one second. */
const SECOND = 1000;

/** Seconds in one minute. */
const MINUTE = 60;

/** Seconds in one hour. */
const HOUR = 3600;

/**
 * Wraps a runtime without `Intl.DurationFormat` in the message shape of the framework.
 *
 * @returns The error to throw.
 */
function durationFormatMissing(): Error {
  return new Error(
    "[game] i18n: Intl.DurationFormat is missing in this runtime.\n" +
      "  Use Bun 1.3.14+, Node 24+ or a WebGPU browser."
  );
}

/**
 * Builds one duration formatter, refusing a runtime that has none. There is no polyfill: every
 * runtime the engine supports ships `Intl.DurationFormat`.
 *
 * @param locale - The locale of the formatter.
 * @param options - What the caller asked for.
 * @returns The formatter.
 * @throws {Error} When the runtime has no `Intl.DurationFormat`.
 */
function buildDurationFormat(
  locale: string,
  options: Intl.DurationFormatOptions | undefined
): Intl.DurationFormat {
  if (typeof Intl.DurationFormat === "undefined") throw durationFormatMissing();

  return new Intl.DurationFormat(locale, options);
}

/**
 * Splits milliseconds into the record `Intl.DurationFormat` reads. The value is rounded up to
 * whole seconds, so a countdown never reads zero while time is left; a negative or non-finite
 * value is zero. Hours and minutes appear when above zero, seconds always, because `format({})`
 * throws. A generated `strings.<locale>.ts` imports it as `duration` for a `{left, duration}`
 * message, and `app.i18n.duration` splits the same way.
 *
 * @param ms - The duration in milliseconds.
 * @returns The hours, minutes and seconds of the duration.
 * @example
 * ```ts
 * // A chest that opens in 95 s, then in an hour and 5 s; a timer that ran out.
 * messageDuration(95_000); // { minutes: 1, seconds: 35 }
 * messageDuration(3_605_000); // { hours: 1, seconds: 5 }
 * messageDuration(-5); // { seconds: 0 }
 * ```
 */
export function messageDuration(ms: number): Partial<Record<Intl.DurationFormatUnit, number>> {
  const total = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / SECOND)) : 0;
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const input: Partial<Record<Intl.DurationFormatUnit, number>> = {};

  if (hours > 0) input.hours = hours;
  if (minutes > 0) input.minutes = minutes;
  input.seconds = total % MINUTE;

  return input;
}

/**
 * Tells whether a parameter is an element node: an object with `type`, `props` and `children`.
 *
 * @param value - The parameter of the message.
 * @returns True for an element node.
 */
function isElementNode(value: unknown): value is ElementNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    "children" in value
  );
}

/**
 * One plain argument of a compiled message as a part: an element node keeps its place in the
 * sentence, a list goes through `Intl.ListFormat` and a number through `Intl.NumberFormat` of the
 * kit's locale, anything else is read as text. A generated `strings.<locale>.ts` imports it as
 * `argument` for a message with `{name}`.
 *
 * @param value - The parameter of the message.
 * @param intl - The formatter kit of the locale the message is formatted in.
 * @returns The part.
 * @example
 * ```ts
 * // A compiled module written by hand, the shape `moku-game keys` writes for "Host: {name}".
 * const lobby: I18n.CompiledMessages = {
 *   "lobby.host": (p, intl) => [{ kind: "text", text: "Host: " }, messageArgument(p.name, intl)]
 * };
 * app.i18n.plain(tr("lobby.host", { name: ["Ann", "Bob", "Cy"] })); // "Host: Ann, Bob, and Cy"
 * app.i18n.format(tr("lobby.host", { name: coin })); // [{ kind: "text", text: "Host: " }, { kind: "element", node: coin }]
 * ```
 */
export function messageArgument(value: unknown, intl: IntlKit): Part {
  if (Array.isArray(value)) {
    return { kind: "text", text: intl.list().format(value as readonly string[]) };
  }

  if (typeof value === "number") return { kind: "text", text: intl.number().format(value) };

  if (isElementNode(value)) return { kind: "element", node: value };

  return { kind: "text", text: String(value) };
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
  const durations = emptyCache<Intl.DurationFormat>();

  return {
    locale,
    plural: options => memo(plurals, options, () => new Intl.PluralRules(locale, options)),
    number: options => memo(numbers, options, () => new Intl.NumberFormat(locale, options)),
    list: options => memo(lists, options, () => new Intl.ListFormat(locale, options)),
    date: options => memo(dates, options, () => new Intl.DateTimeFormat(locale, options)),
    duration: options => memo(durations, options, () => buildDurationFormat(locale, options))
  };
}
