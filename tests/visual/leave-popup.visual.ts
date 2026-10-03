/**
 * @file Visual test: the Leave popup. Back on Home answers the intent `back` of the resting node
 * (the page has no phone, so the test answers it as the Back chain does) and the popup asks
 * "Выйти из игры?" with the wood Leave and the green Stay, which glows (V6 `Glow` on WebGL too).
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const leavePopup = defineVisualTest("leave-popup", {
  start: atHome,
  steps: [{ answer: { intent: "back" } }, { checkpoint: "open" }],
  webgl: true
});
