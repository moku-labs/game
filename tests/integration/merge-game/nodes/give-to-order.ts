/**
 * @file Transit node `giveToOrder`: an item is dragged onto an order. The body is shared with the
 * Deliver button of the order card, so a drag and a button fill an order in exactly the same way,
 * the "Готово!" stamp included.
 */
import { play, type } from "@moku-labs/game";
import { deliverStamp } from "../features/orders/animations";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { applyGive, orderCardOf } from "./give";

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

    await fx(play(deliverStamp, { card }));

    return out.orderComplete({ rewardId: result.rewardId });
  }
});
