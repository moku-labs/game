/**
 * @file The settings as a sub-flow (design §6 E2, E3), used from Home and from the board: the gear
 * is on both screens and opens the same popup. `enter` plays its swing sound and `open` rests on
 * the popup; a volume step or a language switch commits and comes back to it, a reset asks first
 * with the confirm stacked on top. It is left with `closed`: by the X, the backdrop, or a
 * confirmed reset.
 *
 * The id is not "settings": that is the name of the feature, and a feature and a flow share one
 * namespace. The node that holds the sub-flow in the parent graph is called `settings`.
 */
import { exit, type } from "@moku-labs/game";
import { defineFlow } from "../../kit";
import { confirmReset, enter, open, setLocale, setVolume } from "./nodes";

export const settingsFlow = defineFlow("settingsPopup", {
  nodes: { enter, open, setVolume, setLocale, confirm: confirmReset },
  start: "enter",
  outcomes: { closed: type() },
  edges: {
    enter: { done: "open" },
    open: {
      volume: "setVolume",
      setLocale: "setLocale",
      reset: "confirm",
      close: exit("closed")
    },
    setVolume: { done: "open" },
    setLocale: { done: "open" },
    confirm: { cancel: "open", reset: exit("closed") }
  }
});
