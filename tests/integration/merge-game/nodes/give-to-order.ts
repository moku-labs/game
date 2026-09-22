/**
 * @file Transit node `giveToOrder`: an item is dragged onto an order. The body is shared with the
 * order card of the HUD, so a drag and a button fill an order in exactly the same way.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { applyGive } from "./give";

export const giveToOrder = defineNode({
  input: type<GiveInput>(),
  outcomes: {
    done: type(),
    orderComplete: type<{ rewardId: string }>(),
    rejected: type<{ reason: string }>()
  },
  run: ({ input, player, rng, out }) => {
    const result = applyGive(player, input, rng.stream("orders"));

    if (result.kind === "rejected") return out.rejected({ reason: result.reason });
    if (result.kind === "done") return out.done();

    return out.orderComplete({ rewardId: result.rewardId });
  }
});
