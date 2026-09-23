/**
 * @file What an item of the wood chain looks like and is called: its picture and the name the
 * string table knows it by. The board draws the picture on a cell, an order card draws the same
 * picture on its tag, and the info bar names the item that is selected.
 */
import type { AssetKey } from "../generated/assets";

/** The picture of every level of every chain. Generated keys, so a missing picture does not compile. */
const pictures: Record<string, readonly AssetKey[]> = {
  wood: ["board.item-wood-1", "board.item-wood-2", "board.item-wood-3", "board.item-wood-4"]
};

/** The name of every level of the wood chain, as `board.item` selects it (design §8). */
const names = ["twig", "log", "plank", "crate"] as const;

/**
 * The name of one level, as the `item` argument of the `board.item` message takes it.
 *
 * @example
 * ```ts
 * const name: ItemName = "plank";
 * ```
 */
export type ItemName = (typeof names)[number];

/**
 * The picture of one level of one chain. A chain or a level the table does not know falls back to
 * the first picture of the wood chain, so a content mistake is visible instead of invisible.
 *
 * @param chain - The chain of the item.
 * @param level - Its level, from 1.
 * @returns The asset key of its picture.
 * @example
 * ```ts
 * pictureOf("wood", 3); // "board.item-wood-3"
 * ```
 */
export function pictureOf(chain: string, level: number): AssetKey {
  return pictures[chain]?.[level - 1] ?? "board.item-wood-1";
}

/**
 * The name of one level of the wood chain. A level outside the chain reads as the twig.
 *
 * @param level - The level, from 1.
 * @returns The name `board.item` selects on.
 * @example
 * ```ts
 * nameOf(2); // "log"
 * ```
 */
export function nameOf(level: number): ItemName {
  return names[level - 1] ?? "twig";
}
