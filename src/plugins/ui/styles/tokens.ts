/**
 * @file ui/styles — `defineTokens`: the flat design table a game reads in its styles. Pure.
 */
import type { Tokens } from "./types";

/**
 * Declares the design tokens of a game: spaces, colours, radii and font keys, flat and plain.
 *
 * @param tokens - The four groups; every key inside them is the game's own.
 * @returns The same object, frozen.
 * @example
 * ```ts
 * defineTokens({ space: { md: 16 } }).space.md; // 16
 * ```
 */
export function defineTokens<const Given extends Tokens>(tokens: Given): Readonly<Given> {
  return Object.freeze(tokens);
}
