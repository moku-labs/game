/**
 * @file Visual test: Home at rest, the Play plank glowing (V5 `Glow` through the `components`
 * prop), 125 coins in the pill and the daily gift with its "1".
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const home = defineVisualTest("home", {
  start: atHome,
  steps: [{ checkpoint: "rest" }]
});
