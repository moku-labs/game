/**
 * @file Rest node `home`: the checkpoint the whole screen is built from. It waits for one intent.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const home = defineNode({
  scene: "home",
  outcomes: { play: type() },
  rest: true,
  checkpoint: true
});
