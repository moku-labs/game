/**
 * @file scenes plugin — the check of a `leave` a game wrote, in the config (`onInit`) or in a scene (`defineScene`),
 * and of a scene's `enter`. Pure. A game written in plain JS passes anything, so both are a boundary: a field of the
 * wrong shape throws where it was written, not in the middle of a switch.
 */

/** What a field of a `leave` part must be, and the second line of its error. */
type FieldRule = { readonly ok: (value: unknown) => boolean; readonly hint: string };

/** The largest colour, `0xffffff`. */
const MAX_COLOR = 0xff_ff_ff;

/**
 * Tells whether a value is a finite number of at least 0: a duration.
 *
 * @param value - The value.
 * @returns True for a finite number `>= 0`.
 * @example
 * ```ts
 * isDuration(-1); // false
 * ```
 */
function isDuration(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Tells whether a value is an alpha: a number from 0 to 1.
 *
 * @param value - The value.
 * @returns True for a number in `[0, 1]`.
 * @example
 * ```ts
 * isAlpha(1.2); // false
 * ```
 */
function isAlpha(value: unknown): boolean {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * Tells whether a value is a colour `0xRRGGBB`: a whole number from 0 to `0xffffff`.
 *
 * @param value - The value.
 * @returns True for a colour.
 * @example
 * ```ts
 * isColor(0x0b1020); // true
 * ```
 */
function isColor(value: unknown): boolean {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= MAX_COLOR;
}

/**
 * Tells whether a value is a name: a string that is not empty.
 *
 * @param value - The value.
 * @returns True for a string with at least one character.
 * @example
 * ```ts
 * isName(""); // false
 * ```
 */
function isName(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/**
 * Tells whether a value is a plain object a field can be read from.
 *
 * @param value - The value.
 * @returns True for an object that is no array and not `null`.
 * @example
 * ```ts
 * isRecord([]); // false
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The colour of a veil. */
const COLOR_RULE: FieldRule = { ok: isColor, hint: "a colour from 0x000000 to 0xffffff" };

/** The alpha of a veil. */
const ALPHA_RULE: FieldRule = {
  ok: isAlpha,
  hint: "the alpha the veil fades in to, a number from 0 to 1"
};

/** The fields of a veil. */
const COVER_RULES: Readonly<Record<string, FieldRule>> = Object.freeze({
  color: COLOR_RULE,
  alpha: ALPHA_RULE,
  inMs: { ok: isDuration, hint: "the milliseconds of the fade-in, 0 or more" },
  outMs: { ok: isDuration, hint: "the milliseconds of the fade-out, 0 or more" }
});

/** The fields of the veil a scene being entered sets: its look, never its times. */
const ENTER_COVER_RULES: Readonly<Record<string, FieldRule>> = Object.freeze({
  color: COLOR_RULE,
  alpha: ALPHA_RULE
});

/** The fields of a loader. */
const LOADER_RULES: Readonly<Record<string, FieldRule>> = Object.freeze({
  afterMs: { ok: isDuration, hint: "the milliseconds the loader waits for, 0 or more" },
  holdMs: { ok: isDuration, hint: "the milliseconds the swap waits for, 0 or more" },
  texture: { ok: isName, hint: 'an asset key such as "ui.loader.ring"' },
  projection: { ok: isName, hint: 'the name of a registered projection such as "loading"' }
});

/**
 * Builds the error of a field of the wrong shape.
 *
 * @param where - Where the part was written.
 * @param value - What the field holds.
 * @param hint - What to give instead.
 * @returns The error, in the engine's two-line format.
 * @example
 * ```ts
 * wrong("scenes.leave.cover.alpha", 2, "a number from 0 to 1").message;
 * // '[game] scenes.leave.cover.alpha is 2.\n  Give a number from 0 to 1.'
 * ```
 */
function wrong(where: string, value: unknown, hint: string): Error {
  return new Error(`[game] ${where} is ${String(value)}.\n  Give ${hint}.`);
}

/**
 * Checks one part of a `leave`: nothing, `false`, or an object whose every field it knows has the right shape.
 *
 * @param where - Where the part was written, `scenes.leave.cover`.
 * @param part - What the part holds.
 * @param rules - The fields of the part.
 * @throws {Error} For a part that is neither `false` nor an object, and for the first field of the wrong shape.
 */
function checkPart(where: string, part: unknown, rules: Readonly<Record<string, FieldRule>>): void {
  if (part === undefined || part === false) return;
  if (!isRecord(part)) throw wrong(where, part, "an object of its fields, or false");

  for (const [field, rule] of Object.entries(rules)) {
    const value = part[field];

    if (value !== undefined && !rule.ok(value)) throw wrong(`${where}.${field}`, value, rule.hint);
  }
}

/**
 * Checks a `leave` a game wrote: nothing, `false`, or an object whose `cover` and `loader` are each nothing, `false`
 * or an object of the right fields: a colour, an alpha from 0 to 1, durations of 0 or more, and names that are not
 * empty.
 *
 * @param where - Where it was written, for the message: `scenes.leave`, or `Scene "board": leave`.
 * @param leave - What was written.
 * @throws {Error} For the first part or field of the wrong shape.
 * @example
 * ```ts
 * checkLeave("scenes.leave", { cover: { alpha: 2 } });
 * // throws '[game] scenes.leave.cover.alpha is 2.\n  Give the alpha the veil fades in to, a number from 0 to 1.'
 * ```
 */
export function checkLeave(where: string, leave: unknown): void {
  if (leave === undefined || leave === false) return;
  if (!isRecord(leave)) throw wrong(where, leave, "{ cover, loader } or false");

  checkPart(`${where}.cover`, leave.cover, COVER_RULES);
  checkPart(`${where}.loader`, leave.loader, LOADER_RULES);
}

/**
 * Checks a scene's `enter`: nothing, or an object whose `cover` is nothing or an object of a colour and an alpha from 0
 * to 1, by the rules of `leave.cover`.
 *
 * @param where - Where it was written, for the message: `Scene "night": enter`.
 * @param enter - What was written.
 * @throws {Error} For an `enter` that is no object, and for the first field of the wrong shape.
 * @example
 * ```ts
 * checkEnter('Scene "night": enter', { cover: { alpha: 2 } });
 * // throws '[game] Scene "night": enter.cover.alpha is 2.\n  Give the alpha the veil fades in to, a number from 0 to 1.'
 * ```
 */
export function checkEnter(where: string, enter: unknown): void {
  if (enter === undefined) return;
  if (!isRecord(enter)) throw wrong(where, enter, "{ cover }");

  checkPart(`${where}.cover`, enter.cover, ENTER_COVER_RULES);
}
