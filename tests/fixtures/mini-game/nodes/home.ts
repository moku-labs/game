/**
 * @file Rest node `home`: the checkpoint the Home screen is shown on. It waits for the one button
 * of Home, which opens the info popup.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const home = defineNode({
  scene: "home",
  outcomes: { info: type() },
  rest: true,
  checkpoint: true
});
