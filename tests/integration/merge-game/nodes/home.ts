/**
 * @file Rest node `home`: the checkpoint the whole screen is built from. It waits for one of the
 * three buttons of Home: Play, the daily gift and the gear. It also lists `back`, the Back button
 * of the phone (`app.platform.back()`), so Back on Home asks before the game is left.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const home = defineNode({
  scene: "home",
  outcomes: { play: type(), gift: type(), openSettings: type(), back: type() },
  rest: true,
  checkpoint: true
});
