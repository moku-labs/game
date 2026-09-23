/**
 * @file Transit node `deliver`: the Deliver button of an order card was pressed. The same body as
 * a drag onto an order, with the click of the button in front of it. When the give finishes the
 * order, the "Готово!" stamp hits the card before the board is left for the reward popup.
 */
import { play, sfx, type } from "@moku-labs/game";
import { deliverStamp } from "../features/orders/animations";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { applyGive, orderCardOf } from "./give";

export const deliver = defineNode({
  input: type<GiveInput>(),
  outcomes: {
    done: type(),
    orderComplete: type<{ rewardId: string }>(),
    rejected: type<{ reason: string }>()
  },
  run: async ({ input, player, rng, fx, out }) => {
    void fx(sfx("ui.click"));

    const card = orderCardOf(player, input.order);
    const result = applyGive(player, input, rng.stream("orders"));

    if (result.kind === "rejected") return out.rejected({ reason: result.reason });
    if (result.kind === "done") return out.done();

    await fx(play(deliverStamp, { card }));

    return out.orderComplete({ rewardId: result.rewardId });
  }
});
