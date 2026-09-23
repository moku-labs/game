/**
 * @file Transit node `dailyGift`: the gift button of Home was tapped. The gift popup is not built
 * yet, so the node takes the player straight back to Home; it is the place the gift flow will
 * take.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const dailyGift = defineNode({
  outcomes: { done: type() },
  run: ({ out }) => out.done()
});
