/**
 * @file Transit node `tapGenerator`: one tap on the generator. The item, the energy it cost and
 * the charge it spent are granted together, on this edge.
 */
import { schedule, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";

export const tapGenerator = defineNode({
  input: type<{ generatorId: string }>(),
  outcomes: { done: type(), rejected: type<{ reason: string }>() },
  run: async ({ input, player, session, rng, now, fx, out }) => {
    const result = rules.tapGenerator(
      player.merge,
      input.generatorId,
      now,
      tables,
      rng.stream("drop")
    );

    if (!result.ok) return out.rejected({ reason: result.reason });

    applyRules(player, result.state);
    session.taps += 1;
    await fx(schedule(rules.nextDue(player.merge, tables)));

    return out.done();
  }
});
