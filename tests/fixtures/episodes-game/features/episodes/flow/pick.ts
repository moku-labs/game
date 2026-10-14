/**
 * @file Rest node `pick`: the checkpoint the episode picker is shown on. It waits for an episode,
 * or for the way back home.
 */
import { defineNode } from "@core/kit";
import { type } from "@moku-labs/game";

export const pickNode = defineNode({
  scene: "picker",
  outcomes: { ep01: type(), ep02: type(), back: type() },
  rest: true,
  checkpoint: true
});
