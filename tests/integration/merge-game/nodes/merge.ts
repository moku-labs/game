/**
 * @file Transit node `merge`: the item on `from` is dragged onto the item on `to`.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const merge = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type(), rejected: type<{ reason: string }>() },
  run: ({ input, player, out }) => {
    const result = rules.merge(player.merge, input.from, input.to, tables);

    if (!result.legal) return out.rejected({ reason: result.reason });

    applyRules(player, result.state);

    return out.done();
  }
});
