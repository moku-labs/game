/**
 * @file Visual test: the board after a merge. Play opens the board, the Twig on c2_1 is dragged
 * onto the Twig on c0_2 and a Log rises there with a burst of stars (V5 particles). A second of
 * frames lets the last star fall and fade before the checkpoint: the checkpoint lands the
 * motions, and the particles left in the air would be a different picture on every run.
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const boardMerge = defineVisualTest("board-merge", {
  start: atHome,
  steps: [
    { tap: { key: "play" } },
    {
      drag: {
        from: { projection: "board.items", key: "i2" },
        to: { projection: "board.items", key: "i3" }
      }
    },
    { step: { frames: 60 } },
    { checkpoint: "merged" }
  ]
});
