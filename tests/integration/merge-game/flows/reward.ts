/**
 * @file The reward popup as a feature: its own flow, contributed to the `afterOrder` slot of the
 * main flow. Nothing in the main flow knows about it.
 */
import { exit, type } from "@moku-labs/game";
import { defineFeature, defineFlow } from "../kit";
import { grant } from "../nodes/grant";
import { show } from "../nodes/show";

export const rewardFlow = defineFlow("rewardPopup", {
  nodes: { show, grant },
  start: "show",
  outcomes: { done: type() },
  edges: {
    show: { claim: "grant" },
    grant: { done: exit("done") }
  }
});

export const rewardFeature = defineFeature("reward", {
  flows: [rewardFlow],
  contribute: { afterOrder: { flow: rewardFlow, order: 10 } }
});
