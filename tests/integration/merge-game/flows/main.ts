/**
 * @file The main flow: boot, the home checkpoint, the board as a node, and the slot every
 * finished order passes through.
 */
import { slot } from "@moku-labs/game";
import { defineFlow } from "../kit";
import { boot } from "../nodes/boot";
import { home } from "../nodes/home";
import { boardFlow } from "./board";

export const mainFlow = defineFlow("main", {
  nodes: { boot, home, board: boardFlow, afterOrder: slot("afterOrder") },
  start: "boot",
  edges: {
    boot: { ready: "home" },
    home: { play: "board" },
    board: { orderComplete: "afterOrder", left: "home" },
    // Back onto the board: the reward is taken there, the coins fly onto the HUD counter, and the
    // player keeps playing. "home" is reached by leaving the board.
    afterOrder: { done: "board" }
  }
});
