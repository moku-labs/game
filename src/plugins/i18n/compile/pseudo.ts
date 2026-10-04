/**
 * @file i18n plugin, build time — the pseudo-locale `en-XA`: every English message with accented
 * letters, 40 % more length in whole words, and brackets around it. On screen it shows a label
 * that is not translated, a box too small for a longer language and a sentence cut short. It works
 * on the parsed message: only literal text changes; arguments, plural keywords, exact matches, `#`
 * and tags stay as they are. Node and Bun only, like the rest of `compile/`.
 */
import {
  type LiteralElement,
  type MessageFormatElement,
  type PluralOrSelectOption,
  TYPE
} from "@formatjs/icu-messageformat-parser";

/** The ASCII letters, in the order of `ACCENTED`. */
const PLAIN = "abcdefghijklmnopqrstuvwxyz";

/** The accent table: the accented form of each letter of `PLAIN`; a capital takes its upper case. */
const ACCENTED = "áɓçðéƒĝĥíĵķļɱñóþǫŕšţúṿŵẋýž";

/** One ASCII letter of either case. */
const LETTER = /[a-z]/gi;

/** One tag run inside a literal, captured so a split keeps it: `<b>`, `</b>`, `<icon=hud.coin>`. */
const TAG_RUN = /(<\/?[a-z][^<>]*>)/;

/** The words the padding is made of, cycled. */
const PADDING_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten"
];

/** The literal length of a pseudo message against its original, in percent. */
const GROWTH_PERCENT = 140;

/**
 * Accents one ASCII letter, keeping its case.
 *
 * @param letter - One letter from `a` to `z` or `A` to `Z`.
 * @returns The accented letter.
 * @example
 * ```ts
 * accentLetter("P"); // "Þ"
 * ```
 */
function accentLetter(letter: string): string {
  const lower = letter.toLowerCase();
  const accented = ACCENTED.charAt(PLAIN.indexOf(lower));

  return letter === lower ? accented : accented.toUpperCase();
}

/**
 * Splits a literal into its runs: text at even positions, tag runs at odd ones.
 *
 * @param text - One literal of a message.
 * @returns The runs, in order.
 * @example
 * ```ts
 * runsOf("<b>Gold</b>"); // ["", "<b>", "Gold", "</b>", ""]
 * ```
 */
function runsOf(text: string): string[] {
  return text.split(TAG_RUN);
}

/**
 * Tells whether a run of `runsOf` is a tag run.
 *
 * @param index - The position of the run.
 * @returns True for a tag run.
 */
function isTagRun(index: number): boolean {
  return index % 2 === 1;
}

/**
 * Accents every ASCII letter of a literal and copies its tag runs as they are, so the tag pass
 * of `text` still finds them. Every other character stays, and the length does not change.
 *
 * @param text - One literal of a message.
 * @returns The accented literal.
 * @example
 * ```ts
 * accent("<b>Gold</b> 25"); // "<b>Ĝóļð</b> 25"
 * ```
 */
export function accent(text: string): string {
  return runsOf(text)
    .map((run, index) => (isTagRun(index) ? run : run.replaceAll(LETTER, accentLetter)))
    .join("");
}

/**
 * The padding a message of one literal length gets: whole words, each after a space, until the
 * length reaches 140 % of the original. A message with no literal text gets none.
 *
 * @param original - The literal characters of the message outside tags, every branch counted.
 * @returns The padding text.
 * @example
 * ```ts
 * pad(13); // " one two"
 * ```
 */
export function pad(original: number): string {
  const target = Math.ceil((original * GROWTH_PERCENT) / 100);
  const words: string[] = [];
  let length = original;

  while (length < target) {
    const word = PADDING_WORDS[words.length % PADDING_WORDS.length] ?? "";

    words.push(word);
    length += word.length + 1;
  }

  return words.map(word => ` ${word}`).join("");
}

/**
 * Counts the literal characters of a message outside tags, every branch of every plural and
 * select counted.
 *
 * @param elements - The parsed message.
 * @returns The count.
 */
function literalLength(elements: readonly MessageFormatElement[]): number {
  let length = 0;

  for (const element of elements) {
    if (element.type === TYPE.literal) {
      length += runsOf(element.value)
        .filter((_run, index) => !isTagRun(index))
        .join("").length;
    }

    if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) length += literalLength(option.value);
    }
  }

  return length;
}

/**
 * Accents the branches of a plural or a select, keeping their names.
 *
 * @param options - The branches the parser read.
 * @returns The same branches with accented literals.
 */
function accentOptions(
  options: Record<string, PluralOrSelectOption>
): Record<string, PluralOrSelectOption> {
  const accented: Record<string, PluralOrSelectOption> = {};

  for (const [name, option] of Object.entries(options)) {
    accented[name] = { ...option, value: option.value.map(element => accentElement(element)) };
  }

  return accented;
}

/**
 * Accents the literals of one element, at any depth. Arguments, `#` and every name stay.
 *
 * @param element - One parsed element.
 * @returns The element with accented literals.
 */
function accentElement(element: MessageFormatElement): MessageFormatElement {
  if (element.type === TYPE.literal) return { ...element, value: accent(element.value) };
  if (element.type === TYPE.plural) return { ...element, options: accentOptions(element.options) };
  if (element.type === TYPE.select) return { ...element, options: accentOptions(element.options) };

  return element;
}

/**
 * Builds one literal element.
 *
 * @param value - The text.
 * @returns The element.
 */
function literal(value: string): LiteralElement {
  return { type: TYPE.literal, value };
}

/**
 * Derives the `en-XA` message of one English message: accented literals, the padding after the
 * last top-level piece, and brackets around everything. `"Opens in {left, duration, short}"`
 * reads `"[Óþéñš íñ {left, duration, short} one]"`.
 *
 * @param elements - The parsed English message.
 * @returns The parsed pseudo message, ready for `compileElements`.
 */
export function pseudoMessage(elements: readonly MessageFormatElement[]): MessageFormatElement[] {
  const padding = pad(literalLength(elements));

  return [literal("["), ...elements.map(element => accentElement(element)), literal(`${padding}]`)];
}
