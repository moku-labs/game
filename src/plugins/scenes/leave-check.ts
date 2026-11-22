/**
 * @file scenes plugin — the check of a `leave` a game wrote, in the config (`onInit`) or in a scene (`defineScene`),
 * and of a scene's `enter`. Pure. A game written in plain JS passes anything, so both are a boundary: a field of the
 * wrong shape throws where it was written, not in the middle of a switch. A transition (spec 36) is checked by its kind:
 * every field of the kind in its range, and no field of another kind.
 */
import { EASE_NAMES } from "../anim/tween/easing";

/** What a field of a `leave` part must be, and the second line of its error. */
type FieldRule = { readonly ok: (value: unknown) => boolean; readonly hint: string };

/** The largest colour, `0xffffff`. */
const MAX_COLOR = 0xff_ff_ff;

/** The longest a transition may take, in milliseconds. */
const MAX_TRANSITION_MS = 5000;

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

/**
 * Tells whether a value is a number above 0 and at most the longest a transition may take: its `ms`.
 *
 * @param value - The value.
 * @returns True for a finite number in `(0, 5000]`.
 * @example
 * ```ts
 * isTransitionMs(5001); // false
 * ```
 */
function isTransitionMs(value: unknown): boolean {
  return typeof value === "number" && value > 0 && value <= MAX_TRANSITION_MS;
}

/**
 * Tells whether a value is a finite number above 0.
 *
 * @param value - The value.
 * @returns True for a finite number above 0.
 * @example
 * ```ts
 * isPositive(0); // false
 * ```
 */
function isPositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Tells whether a value is a finite number.
 *
 * @param value - The value.
 * @returns True for a finite number.
 * @example
 * ```ts
 * isFiniteNumber(Number.POSITIVE_INFINITY); // false
 * ```
 */
function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tells whether a value is a curve a transition can run on: a name `applyEase` knows, or a function of the time.
 *
 * @param value - The value.
 * @returns True for a known name or a function.
 * @example
 * ```ts
 * isEase("outBack"); // true
 * ```
 */
function isEase(value: unknown): boolean {
  const names: readonly unknown[] = EASE_NAMES;

  return typeof value === "function" || names.includes(value);
}

/**
 * Lists names the way a sentence does: `a, b and c`.
 *
 * @param names - The names, two at least or one alone.
 * @param word - The word before the last name.
 * @returns The list.
 * @example
 * ```ts
 * listOf(["kind", "ms", "to"], "and"); // "kind, ms and to"
 * ```
 */
function listOf(names: readonly string[], word: "and" | "or"): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} ${word} ${names.at(-1)}`;
}

/**
 * Builds the rule of a field that is one of a list of strings.
 *
 * @param names - The values it may hold.
 * @returns The rule, its hint naming them all.
 * @example
 * ```ts
 * oneOf(["cut", "keep"]).hint; // 'one of "cut" or "keep"'
 * ```
 */
function oneOf(names: readonly string[]): FieldRule {
  const allowed: readonly unknown[] = names;

  return {
    ok: value => allowed.includes(value),
    hint: `one of ${listOf(
      names.map(name => `"${name}"`),
      "or"
    )}`
  };
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

/** The kinds of transition, and the fields each takes beside the common ones. */
const TRANSITION_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  fade: [],
  slide: ["to"],
  wipe: ["angle", "soft"],
  iris: ["x", "y", "soft"],
  dissolve: ["scale", "edge", "edgeColor"]
});

/** The fields every kind of transition takes. */
const TRANSITION_COMMON = ["kind", "ms", "ease", "reduced"] as const;

/** A share of the screen, a number from 0 to 1. */
const SHARE_RULE: FieldRule = { ok: isAlpha, hint: "a share of the screen, a number from 0 to 1" };

/** The fields of a transition, by name; a kind reads the ones it takes. */
const TRANSITION_RULES: Readonly<Record<string, FieldRule>> = Object.freeze({
  kind: oneOf(Object.keys(TRANSITION_KINDS)),
  ms: {
    ok: isTransitionMs,
    hint: `the milliseconds the transition takes, more than 0 and at most ${MAX_TRANSITION_MS}`
  },
  ease: {
    ok: isEase,
    hint: `a curve name (${listOf(
      EASE_NAMES.map(name => `"${name}"`),
      "or"
    )}) or a function of the time`
  },
  reduced: oneOf(["cut", "keep"]),
  to: oneOf(["left", "right", "up", "down"]),
  angle: { ok: isFiniteNumber, hint: "the angle in radians, a finite number" },
  soft: { ok: isAlpha, hint: "the softness of the edge, a number from 0 to 1" },
  x: SHARE_RULE,
  y: SHARE_RULE,
  scale: { ok: isPositive, hint: "the cells of the noise across the screen, a number above 0" },
  edge: { ok: isAlpha, hint: "the width of the rim, a number from 0 to 1" },
  edgeColor: COLOR_RULE
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
 * Checks a transition a game wrote: an object whose `kind` is one of the five, whose common fields and whose kind's
 * own fields have the right shape, and that holds no field of another kind.
 *
 * @param where - Where it was written, `scenes.leave.transition`.
 * @param transition - What was written.
 * @param offable - Whether `false` is a value: it is for a `leave`, which turns the transition off, and no other place.
 * @throws {Error} For the first field of the wrong shape, and for a field the kind does not take.
 */
function checkTransition(where: string, transition: unknown, offable: boolean): void {
  if (transition === undefined || (offable && transition === false)) return;
  if (!isRecord(transition)) {
    throw wrong(where, transition, offable ? "an object { kind } or false" : "an object { kind }");
  }

  const kind = transition.kind;
  const own =
    typeof kind === "string" && Object.hasOwn(TRANSITION_KINDS, kind)
      ? TRANSITION_KINDS[kind]
      : undefined;

  if (own === undefined) throw wrong(`${where}.kind`, kind, TRANSITION_RULES.kind?.hint ?? "");

  const takes: readonly string[] = [...TRANSITION_COMMON, ...own];

  for (const field of Object.keys(transition)) {
    if (!takes.includes(field)) {
      throw new Error(
        `[game] ${where}.${field} is ${String(transition[field])}.\n  A "${String(kind)}" transition takes ${listOf(takes, "and")}; leave "${field}" out.`
      );
    }
  }

  for (const field of takes) {
    const value = transition[field];
    const rule = TRANSITION_RULES[field];

    if (value !== undefined && rule !== undefined && !rule.ok(value)) {
      throw wrong(`${where}.${field}`, value, rule.hint);
    }
  }
}

/**
 * Checks a `leave` a game wrote: nothing, `false`, or an object whose `cover` and `loader` are each nothing, `false`
 * or an object of the right fields: a colour, an alpha from 0 to 1, durations of 0 or more, and names that are not
 * empty. Its `transition` is nothing, `false`, or an object of one of the five kinds.
 *
 * @param where - Where it was written, for the message: `scenes.leave`, or `Scene "board": leave`.
 * @param leave - What was written.
 * @throws {Error} For the first part or field of the wrong shape.
 * @example
 * ```ts
 * checkLeave("scenes.leave", { cover: { alpha: 2 } });
 * // throws '[game] scenes.leave.cover.alpha is 2.\n  Give the alpha the veil fades in to, a number from 0 to 1.'
 * checkLeave("scenes.leave", { transition: { kind: "fade", ms: 0 } });
 * // throws '[game] scenes.leave.transition.ms is 0.\n  Give the milliseconds the transition takes, more than 0 and at most 5000.'
 * ```
 */
export function checkLeave(where: string, leave: unknown): void {
  if (leave === undefined || leave === false) return;
  if (!isRecord(leave)) throw wrong(where, leave, "{ cover, loader } or false");

  checkPart(`${where}.cover`, leave.cover, COVER_RULES);
  checkPart(`${where}.loader`, leave.loader, LOADER_RULES);
  checkTransition(`${where}.transition`, leave.transition, true);
}

/**
 * Checks a scene's `enter`: nothing, or an object whose `cover` is nothing or an object of a colour and an alpha from 0
 * to 1, by the rules of `leave.cover`, and whose `transition` is nothing or an object of one of the five kinds (`false`
 * is refused: `enter` never turns a transition off).
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
  checkTransition(`${where}.transition`, enter.transition, false);
}
