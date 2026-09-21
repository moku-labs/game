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
    afterOrder: { done: "home" }
  }
});
