/**
 * @file Merge kit — the `rules` object and the public types. Pure, no engine import.
 */
import { elapse, nextDue } from "./elapse";
import { pickDrop, tapGenerator } from "./generators";
import { findFreeCell, itemAt, neighbors } from "./grid";
import { place, take } from "./inventory";
import { giveToOrder, isLegalOrderMatch } from "./orders";
import { isLegalMerge, merge, sell } from "./rules";

/**
 * The merge rules as one object, so game code reads `rules.merge(...)`. Every function is pure:
 * it returns a new state and never mutates its inputs.
 *
 * @example
 * ```ts
 * const result = rules.merge(player.merge, "c0_0", "c1_0", tables);
 * if (result.legal) player.merge = result.state;
 * ```
 */
export const rules = {
  neighbors,
  findFreeCell,
  itemAt,
  isLegalMerge,
  merge,
  sell,
  pickDrop,
  tapGenerator,
  isLegalOrderMatch,
  giveToOrder,
  elapse,
  nextDue,
  place,
  take
};

export type * from "./types";
