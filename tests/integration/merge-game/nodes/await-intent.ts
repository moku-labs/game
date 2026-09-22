/**
 * @file Rest node `awaitIntent`: the board waiting for the player. A pure wait, no body — the
 * answer the gate takes names the outcome, and `elapsed` arrives the same way from the clock. It
 * is the node the board scene is shown on; a headless game without the screen ignores the name.
 *
 * `give` is the drag onto an order, `deliver` the order card of the HUD, and `openSettings` the
 * gear next to it: a button of the interface answers this gate like any other gesture.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { GiveInput } from "../rules";

export const awaitIntent = defineNode({
  scene: "board",
  outcomes: {
    tap: type<{ generatorId: string }>(),
    merge: type<{ from: string; to: string }>(),
    give: type<GiveInput>(),
    deliver: type<GiveInput>(),
    openSettings: type(),
    leave: type(),
    elapsed: type<{ now: number }>()
  },
  rest: true,
  inbox: ["elapsed"]
});
