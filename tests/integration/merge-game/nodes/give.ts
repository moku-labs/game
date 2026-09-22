/**
 * @file What both ways of filling an order do: the drag onto an order slot and the order card of
 * the HUD run the same body, so the two paths can never drift apart.
 *
 * The rules pay a finished order where it is earned. This game holds that payout back: the coins
 * go into `pendingCoins` and the wallet stays as it was until the player takes the reward out of
 * the popup. That is what lets the coins fly from the card to the counter — a number already in
 * the wallet has nowhere to travel from.
 */
import type { GiveInput, Rng } from "../rules";
import { rules } from "../rules";
import type { Player } from "../state";
import { applyRules } from "../state";
import { tables } from "../tables";

/**
 * What one give did: nothing (refused), a need marked, or an order finished.
 *
 * @example
 * ```ts
 * const outcome: GiveOutcome = { kind: "orderComplete", rewardId: "planks" };
 * ```
 */
export type GiveOutcome =
  | { kind: "rejected"; reason: string }
  | { kind: "done" }
  | { kind: "orderComplete"; rewardId: string };

/**
 * Gives one item to one order and writes the result into the player draft. A finished order
 * leaves its reward in `pendingCoins` and `pendingReward`; `grant` pays it after the claim.
 *
 * @param player - The player draft of the open transaction.
 * @param input - The item to give and the order that takes it.
 * @param rng - The stream the next order is drawn from.
 * @returns Which outcome the node takes.
 */
export function applyGive(player: Player, input: GiveInput, rng: Rng): GiveOutcome {
  const result = rules.giveToOrder(player.merge, input, tables, rng);

  if (!result.ok) return { kind: "rejected", reason: result.reason };

  const paid = player.merge.wallet.coins ?? 0;

  applyRules(player, result.state);

  const rewardId = result.rewardId;

  if (!result.completed || rewardId === undefined) return { kind: "done" };

  // The reward the rules paid is taken back out of the wallet and parked until the claim.
  player.pendingCoins = (player.merge.wallet.coins ?? 0) - paid;
  player.merge.wallet.coins = paid;
  // The popup outlives this edge, so what it shows is saved, not carried in the payload.
  player.pendingReward = rewardId;

  return { kind: "orderComplete", rewardId };
}
