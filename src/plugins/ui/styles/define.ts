/**
 * @file ui/styles — `defineStyle`: the type check of the vocabulary and a frozen object, its edges frozen too. Pure.
 */
import type { BaseStyle, Style, TextTagStyle } from "./types";

/**
 * Freezes the padding and the margin a style or a variant writes per edge.
 *
 * @param part - The base or one variant.
 */
function freezeEdges(part: BaseStyle | undefined): void {
  if (part === undefined) return;
  if (typeof part.padding === "object") Object.freeze(part.padding);
  if (typeof part.margin === "object") Object.freeze(part.margin);
}

/**
 * Declares one style. The work is the type: a field outside the vocabulary, or a value outside
 * its union, is an error where the style is written, not where it is used.
 *
 * @param style - The style, with its `is` and `when` variants; the style of a text may name its
 *   text style key, in its base and in its `when` variants.
 * @returns The same object, frozen, with the padding and the margin of its base and its variants: a resolution
 *   hands those edges to every element of the style as they are.
 * @example
 * ```ts
 * defineStyle({ direction: "row", gap: 12 }).gap; // 12
 * defineStyle({ text: "title.19", when: { tall: { text: "title.20.5" } } }).when.tall.text; // "title.20.5"
 * ```
 */
export function defineStyle<const Given extends Style | TextTagStyle>(
  style: Given
): Readonly<Given> {
  freezeEdges(style);
  for (const variant of Object.values(style.when ?? {})) freezeEdges(variant);
  for (const variant of Object.values(style.is ?? {})) freezeEdges(variant);

  return Object.freeze(style);
}
