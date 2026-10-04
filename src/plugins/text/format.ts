/**
 * @file text plugin — the four formats of a bound number. Pure: no ctx, no clock, no `Intl` of
 * its own. A `"duration"` goes through the formatter the caller hands in, which is `i18n`.
 */
import type { TextFormat } from "./types";

/** Milliseconds in one second. */
const SECOND_MS = 1000;

/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60;

/** Seconds in one hour. */
const SECONDS_PER_HOUR = 3600;

/**
 * Tells whether a string is one of the four formats, for a bind that slipped past the type.
 *
 * @param format - What a bind carries.
 * @returns True for `"int"`, `"mm:ss"`, `"h:mm:ss"` and `"duration"`.
 * @example
 * ```ts
 * isTextFormat("ss"); // false
 * ```
 */
export function isTextFormat(format: string): format is TextFormat {
  return format === "int" || format === "mm:ss" || format === "h:mm:ss" || format === "duration";
}

/**
 * Pads a number to two digits. A longer number stays as it is.
 *
 * @param value - A whole number, 0 or more.
 * @returns The number with a leading zero below 10.
 * @example
 * ```ts
 * pad2(5); // "05"
 * ```
 */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Whole seconds of a time in milliseconds, rounded up, never below zero. A value that is not
 * finite counts as zero.
 *
 * @param ms - The time in milliseconds.
 * @returns The whole seconds a timer shows.
 * @example
 * ```ts
 * wholeSeconds(94_001); // 95
 * ```
 */
export function wholeSeconds(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / SECOND_MS)) : 0;
}

/**
 * What the shown string of a bound value is built from: the rounded value for `"int"`, whole
 * seconds for a time format. Two values with the same unit show the same string.
 *
 * @param value - The bound number.
 * @param format - How it is shown.
 * @returns The unit of the shown string.
 * @example
 * ```ts
 * unitOf(94_500, "mm:ss"); // 95
 * ```
 */
export function unitOf(value: number, format: TextFormat): number {
  if (format !== "int") return wholeSeconds(value);

  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Shows a bound number in one of the four formats. A value that is not finite shows as zero.
 *
 * @param value - The number; milliseconds for the time formats.
 * @param format - How it is shown.
 * @param duration - Formats milliseconds as words in the current locale.
 * @returns The string a label shows.
 * @example
 * ```ts
 * formatBound(95_000, "mm:ss", () => ""); // "01:35"
 * ```
 */
export function formatBound(
  value: number,
  format: TextFormat,
  duration: (ms: number) => string
): string {
  const unit = unitOf(value, format);

  switch (format) {
    case "int": {
      return String(unit);
    }
    case "mm:ss": {
      const minutes = Math.floor(unit / SECONDS_PER_MINUTE);

      return `${pad2(minutes)}:${pad2(unit % SECONDS_PER_MINUTE)}`;
    }
    case "h:mm:ss": {
      const hours = Math.floor(unit / SECONDS_PER_HOUR);
      const minutes = Math.floor(unit / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE;

      return `${hours}:${pad2(minutes)}:${pad2(unit % SECONDS_PER_MINUTE)}`;
    }
    case "duration": {
      return duration(unit * SECOND_MS);
    }
  }
}
