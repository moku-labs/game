/**
 * @file Visual test: the daily gift popup. The gift of Home opens it with the "+50" prize and the
 * note on the parchment, two lines of wrapped text with the coin icon riding in the second line
 * (V5 icons in wrapped text).
 * The green Claim glows, so the test also runs in the WebGL leg (`--webgl`).
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const giftPopup = defineVisualTest("gift-popup", {
  start: atHome,
  steps: [{ tap: { key: "gift" } }, { checkpoint: "open" }],
  webgl: true
});
