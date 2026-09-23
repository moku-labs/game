/**
 * @file Transit node `energy`: the sawmill was tapped with an empty bar. The Out of energy popup
 * says when the next point arrives; Watch & refill fills the bar at once (the design stubs the
 * ad), Later and the backdrop go back to the board with nothing changed.
 */
import type { Flow } from "@moku-labs/game";
import { schedule, type } from "@moku-labs/game";
import { OutOfEnergy } from "../features/energy/out-of-energy";
import { clockOf, refillIn } from "../features/energy/refill";
import { showPopup } from "../features/ui/popup";
import { defineNode, popup } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const energy = defineNode({
  outcomes: { watch: type(), later: type() },
  run: async ({ player, now, fx, out }) => {
    const caughtUp = rules.elapse(player.merge, now, tables);
    const wait = refillIn(caughtUp.energy, now, tables.energy.regenMs);
    const answered = (await showPopup(fx, popup(OutOfEnergy, { refillIn: clockOf(wait) }))) as
      | Flow.Answer
      | undefined;

    if (answered?.intent !== "watch") return out.later();

    applyRules(player, caughtUp);
    player.merge.energy = { ...caughtUp.energy, value: caughtUp.energy.max, countedAt: now };
    await fx(schedule(rules.nextDue(player.merge, tables)));

    return out.watch();
  }
});
