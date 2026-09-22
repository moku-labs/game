/**
 * @file The board as a sub-flow: one rest node the player answers, and one transit node per move.
 * It is left with `orderComplete` when an order was filled, or with `left`. The three settings
 * nodes hang off the same rest node, because the gear that opens them sits in the HUD of the
 * board.
 */
import { exit, type } from "@moku-labs/game";
import { openSettings, setLocale, setVolume } from "../features/settings/nodes";
import { defineFlow } from "../kit";
import { awaitIntent } from "../nodes/await-intent";
import { catchUp } from "../nodes/catch-up";
import { deliver } from "../nodes/deliver";
import { giveToOrder } from "../nodes/give-to-order";
import { merge } from "../nodes/merge";
import { tapGenerator } from "../nodes/tap-generator";

export const boardFlow = defineFlow("board", {
  nodes: {
    awaitIntent,
    tapGenerator,
    merge,
    giveToOrder,
    deliver,
    catchUp,
    openSettings,
    setVolume,
    setLocale
  },
  start: "awaitIntent",
  outcomes: { orderComplete: type<{ rewardId: string }>(), left: type() },
  edges: {
    awaitIntent: {
      tap: "tapGenerator",
      merge: "merge",
      give: "giveToOrder",
      deliver: "deliver",
      openSettings: "openSettings",
      leave: exit("left"),
      elapsed: "catchUp"
    },
    tapGenerator: { done: "awaitIntent", rejected: "awaitIntent" },
    merge: { done: "awaitIntent", rejected: "awaitIntent" },
    giveToOrder: {
      done: "awaitIntent",
      orderComplete: exit("orderComplete"),
      rejected: "awaitIntent"
    },
    deliver: {
      done: "awaitIntent",
      orderComplete: exit("orderComplete"),
      rejected: "awaitIntent"
    },
    catchUp: { done: "awaitIntent" },
    openSettings: {
      volume: "setVolume",
      setLocale: "setLocale",
      close: "awaitIntent"
    },
    setVolume: { done: "awaitIntent" },
    setLocale: { done: "awaitIntent" }
  }
});
