/**
 * @file The main flow: boot, the splash that waits for the bundles, the home checkpoint with its
 * three buttons, the board as a node, and the slot every finished order passes through. The
 * settings nodes hang off Home as they hang off the board, because the gear is on both screens.
 */
import { slot } from "@moku-labs/game";
import { openSettings, setLocale, setVolume } from "../features/settings/nodes";
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
    openSettings,
    setVolume,
    setLocale,
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
      openSettings: "openSettings"
    },
    dailyGift: { done: "home" },
    openSettings: {
      volume: "setVolume",
      setLocale: "setLocale",
      close: "home"
    },
    setVolume: { done: "home" },
    setLocale: { done: "home" },
    board: { orderComplete: "afterOrder", left: "home" },
    // Back onto the board: the reward is taken there, the coins fly onto the HUD counter, and the
    // player keeps playing. "home" is reached by leaving the board.
    afterOrder: { done: "board" }
  }
});
