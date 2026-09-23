/**
 * @file Transit node `merge`: the item on `from` is dragged onto the item on `to`. A legal merge
 * bursts into sparkles and leaves on the item that rose (design §6 F4); the node does not wait
 * for them, so the next drag is free at once.
 */
import { play, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";
import { mergeBurst } from "../view/animations";

export const merge = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type(), rejected: type<{ reason: string }>() },
  run: ({ input, player, fx, out }) => {
    const result = rules.merge(player.merge, input.from, input.to, tables);

    if (!result.legal) return out.rejected({ reason: result.reason });

    applyRules(player, result.state);
    // The risen item keeps the id of the target, so the burst aims at the item that stays.
    void fx(play(mergeBurst, { item: { projection: "board.items", key: result.item.id } }));

    return out.done();
  }
});
