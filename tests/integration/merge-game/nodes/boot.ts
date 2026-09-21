/**
 * @file Transit node `boot`: catch the save up with the time that passed while the game was
 * closed, then arm the clock for the next moment the rules care about.
 */
import { schedule, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const boot = defineNode({
  outcomes: { ready: type() },
  run: async ({ player, now, fx, out }) => {
    applyRules(player, rules.elapse(player.merge, now, tables));
    await fx(schedule(rules.nextDue(player.merge, tables)));

    return out.ready();
  }
});
