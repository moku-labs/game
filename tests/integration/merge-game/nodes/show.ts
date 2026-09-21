/**
 * @file Rest node `show`: the reward popup, drawn over the board. A pure wait for one intent.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const show = defineNode({
  outcomes: { claim: type() },
  rest: true,
  over: true
});
