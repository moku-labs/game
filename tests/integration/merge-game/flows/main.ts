/**
 * @file The main flow: boot, the splash that waits for the bundles, the home checkpoint with its
 * three buttons, the board as a node, and the slot every finished order passes through. The
 * settings sub-flow hangs off Home as it hangs off the board, because the gear is on both
 * screens; the daily gift is a popup of Home.
 */
import { slot } from "@moku-labs/game";
import { settingsFlow } from "../features/settings/flow";
import { defineFlow } from "../kit";
import { boot } from "../nodes/boot";
import { dailyGift } from "../nodes/daily-gift";
import { home } from "../nodes/home";
import { setLoading } from "../nodes/set-loading";
import { splash } from "../nodes/splash";
import { boardFlow } from "./board";

export const mainFlow = defineFlow("main", {
  nodes: {
    boot,
    splash,
    setLoading,
    home,
    dailyGift,
    settings: settingsFlow,
    board: boardFlow,
    afterOrder: slot("afterOrder")
  },
  start: "boot",
  edges: {
    boot: { ready: "splash" },
    splash: { progress: "setLoading", loaded: "home" },
    setLoading: { done: "splash" },
    home: {
      play: "board",
      gift: "dailyGift",
      openSettings: "settings"
    },
    dailyGift: { claim: "home", close: "home" },
    settings: { closed: "home" },
    board: { orderComplete: "afterOrder", left: "home" },
    // Back onto the board: the reward is taken there, the coins fly onto the HUD counter, and the
    // player keeps playing. "home" is reached by leaving the board.
    afterOrder: { done: "board" }
  }
});
