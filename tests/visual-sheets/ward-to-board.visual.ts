/**
 * @file Visual test: the walk from the ward to the board, the HUD present in every frame of the switch.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atWard } from "./fixture";

export const wardToBoard = defineVisualTest("ward-to-board", {
  start: atWard,
  steps: [
    { tap: { key: "wardBoard" } },
    { step: { frames: 2 } },
    { checkpoint: "switching" },
    { step: { frames: 30 } },
    { checkpoint: "board" }
  ],
  webgl: true
});
