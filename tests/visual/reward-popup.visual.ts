/**
 * @file Visual test: the reward popup. Play opens the board, Deliver on the first order card
 * gives it the Plank, the stamp hits the card and the popup shows the reward of 25 coins.
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const rewardPopup = defineVisualTest("reward-popup", {
  start: atHome,
  steps: [{ tap: { key: "play" } }, { tap: { key: "deliver0" } }, { checkpoint: "open" }]
});
