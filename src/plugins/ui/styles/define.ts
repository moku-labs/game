/**
 * @file ui/styles — `defineStyle`: the type check of the vocabulary and a frozen object. Pure.
 */
import type { Style } from "./types";

/**
 * Declares one style. The work is the type: a field outside the vocabulary, or a value outside
 * its union, is an error where the style is written, not where it is used.
 *
 * @param style - The style, with its `is` and `when` variants.
 * @returns The same object, frozen.
 * @example
 * ```ts
 * defineStyle({ direction: "row", gap: 12 }).gap; // 12
 * ```
 */
export function defineStyle<const Given extends Style>(style: Given): Readonly<Given> {
  return Object.freeze(style);
}
