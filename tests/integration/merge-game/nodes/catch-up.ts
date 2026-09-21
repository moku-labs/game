/**
 * @file Transit node `catchUp`: the clock said a due moment arrived. Turn the time that passed
 * into state and arm the next moment.
 */
import { schedule, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const catchUp = defineNode({
  outcomes: { done: type() },
  run: async ({ player, now, fx, out }) => {
    applyRules(player, rules.elapse(player.merge, now, tables));
    await fx(schedule(rules.nextDue(player.merge, tables)));

    return out.done();
  }
});
