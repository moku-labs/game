/**
 * @file The board as a sub-flow: one rest node the player answers, and one transit node per move.
 * A tap on an item selects it through `select`, which writes the session and comes straight back.
 * It is left with `orderComplete` when an order was filled, or with `left`. A refused tap of the
 * sawmill says why: `energy` shows the Out of energy popup, `toast` the "board is full" sign. The
 * settings sub-flow hangs off the same rest node, because the gear sits in the HUD of the board.
 */
import { exit, type } from "@moku-labs/game";
import { settingsFlow } from "../features/settings/flow";
import { defineFlow } from "../kit";
import { awaitIntent } from "../nodes/await-intent";
import { catchUp } from "../nodes/catch-up";
import { deliver } from "../nodes/deliver";
import { energy } from "../nodes/energy";
import { giveToOrder } from "../nodes/give-to-order";
import { merge } from "../nodes/merge";
import { select } from "../nodes/select";
import { tapGenerator } from "../nodes/tap-generator";
import { toast } from "../nodes/toast";

export const boardFlow = defineFlow("board", {
  nodes: {
    awaitIntent,
    tapGenerator,
    select,
    merge,
    giveToOrder,
    deliver,
    catchUp,
    energy,
    toast,
    settings: settingsFlow
  },
  start: "awaitIntent",
  outcomes: { orderComplete: type<{ rewardId: string }>(), left: type() },
  edges: {
    awaitIntent: {
      tap: "tapGenerator",
      select: "select",
      merge: "merge",
      give: "giveToOrder",
      deliver: "deliver",
      openSettings: "settings",
      leave: exit("left"),
      elapsed: "catchUp"
    },
    tapGenerator: {
      done: "awaitIntent",
      noEnergy: "energy",
      boardFull: "toast",
      rejected: "awaitIntent"
    },
    select: { done: "awaitIntent" },
    energy: { watch: "awaitIntent", later: "awaitIntent" },
    toast: { done: "awaitIntent" },
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
    settings: { closed: "awaitIntent" }
  }
});
