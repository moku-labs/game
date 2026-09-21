/**
 * @file Transit node `giveToOrder`: an item is given to an order. The reward of a finished order
 * is already in the wallet the rules return; the popup only shows what was won.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const giveToOrder = defineNode({
  input: type<GiveInput>(),
  outcomes: {
    done: type(),
    orderComplete: type<{ rewardId: string }>(),
    rejected: type<{ reason: string }>()
  },
  run: ({ input, player, session, rng, out }) => {
    const result = rules.giveToOrder(player.merge, input, tables, rng.stream("orders"));

    if (!result.ok) return out.rejected({ reason: result.reason });

    applyRules(player, result.state);

    const rewardId = result.rewardId;

    if (!result.completed || rewardId === undefined) return out.done();

    // The popup outlives this edge, so what it shows goes to the session, not into the payload.
    session.pendingReward = rewardId;

    return out.orderComplete({ rewardId });
  }
});
