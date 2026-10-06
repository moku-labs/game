/**
 * @file Visual test: the info popup. The info button of Home opens it over the dimmed screen,
 * with the spark, the counter and the OK button on its panel.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atHome } from "./fixture";

export const infoPopup = defineVisualTest("info-popup", {
  start: atHome,
  steps: [{ tap: { key: "info" } }, { checkpoint: "open" }]
});
