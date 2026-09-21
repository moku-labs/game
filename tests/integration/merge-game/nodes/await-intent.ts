/**
 * @file Rest node `awaitIntent`: the board waiting for the player. A pure wait, no body — the
 * answer the gate takes names the outcome, and `elapsed` arrives the same way from the clock.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";

export const awaitIntent = defineNode({
  outcomes: {
    tap: type<{ generatorId: string }>(),
    merge: type<{ from: string; to: string }>(),
    give: type<GiveInput>(),
    leave: type(),
    elapsed: type<{ now: number }>()
  },
  rest: true,
  inbox: ["elapsed"]
});
