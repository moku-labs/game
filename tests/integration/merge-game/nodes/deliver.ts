/**
 * @file Transit node `deliver`: the order card of the HUD was pressed. The same body as a drag
 * onto an order, with the click of the button in front of it.
 */
import { sfx, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";
import { applyGive } from "./give";

export const deliver = defineNode({
  input: type<GiveInput>(),
  outcomes: {
    done: type(),
    orderComplete: type<{ rewardId: string }>(),
    rejected: type<{ reason: string }>()
  },
  run: ({ input, player, rng, fx, out }) => {
    void fx(sfx("ui.click"));

    const result = applyGive(player, input, rng.stream("orders"));

    if (result.kind === "rejected") return out.rejected({ reason: result.reason });
    if (result.kind === "done") return out.done();

    return out.orderComplete({ rewardId: result.rewardId });
  }
});
