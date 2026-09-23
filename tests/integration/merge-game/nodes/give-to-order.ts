/**
 * @file Transit node `giveToOrder`: an item is dragged onto an order. The body is shared with the
 * Deliver button of the order card, so a drag and a button fill an order in exactly the same way,
 * the flight into the card and the "Готово!" stamp included.
 */
import { play, type } from "@moku-labs/game";
import { deliverStamp } from "../features/orders/animations";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { applyGive, deliveredItemOf, orderCardOf } from "./give";

export const giveToOrder = defineNode({
  input: type<GiveInput>(),
  outcomes: {
    done: type(),
    orderComplete: type<{ rewardId: string }>(),
    rejected: type<{ reason: string }>()
  },
  run: async ({ input, player, rng, fx, out }) => {
    const card = orderCardOf(player, input.order);
    const result = applyGive(player, input, rng.stream("orders"));

    if (result.kind === "rejected") return out.rejected({ reason: result.reason });
    if (result.kind === "done") return out.done();

    // The item flies into the card and the stamp hits it while the give is still a draft: the
    // edge commits it, and the item leaves the board from the card.
    await fx(play(deliverStamp, { item: deliveredItemOf(input), card }));

    return out.orderComplete({ rewardId: result.rewardId });
  }
});
