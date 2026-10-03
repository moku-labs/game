/**
 * @file The main flow: boot, the splash that waits for the bundles and offers a retry when one of
 * them fails, the home checkpoint with its three buttons, the board as a node, and the slot every
 * finished order passes through. The settings sub-flow hangs off Home as it hangs off the board,
 * because the gear is on both screens; the daily gift is a popup of Home, and so is the Leave
 * popup that Back on Home asks first with.
 */
import { slot } from "@moku-labs/game";
import { settingsFlow } from "../features/settings/flow";
import { defineFlow } from "../kit";
import { boot } from "../nodes/boot";
import { dailyGift } from "../nodes/daily-gift";
import { home } from "../nodes/home";
import { leaveGame } from "../nodes/leave-game";
import { loadFailed } from "../nodes/load-failed";
import { retryLoading } from "../nodes/retry-loading";
import { setLoading } from "../nodes/set-loading";
import { splash } from "../nodes/splash";
import { boardFlow } from "./board";

export const mainFlow = defineFlow("main", {
  nodes: {
    boot,
    splash,
    setLoading,
    loadFailed,
    retryLoading,
    home,
    dailyGift,
    leaveGame,
    settings: settingsFlow,
    board: boardFlow,
    afterOrder: slot("afterOrder")
  },
  start: "boot",
  edges: {
    boot: { ready: "splash" },
    splash: {
      progress: "setLoading",
      loaded: "home",
      failed: "loadFailed",
      retry: "retryLoading"
    },
    setLoading: { done: "splash" },
    loadFailed: { done: "splash" },
    retryLoading: { done: "splash" },
    home: {
      play: "board",
      gift: "dailyGift",
      openSettings: "settings",
      back: "leaveGame"
    },
    dailyGift: { claim: "home", close: "home" },
    leaveGame: { leave: "home", stay: "home" },
    settings: { closed: "home" },
    board: { orderComplete: "afterOrder", left: "home" },
    // Back onto the board: the reward is taken there, the coins fly onto the HUD counter, and the
    // player keeps playing. "home" is reached by leaving the board.
    afterOrder: { done: "board" }
  }
});
