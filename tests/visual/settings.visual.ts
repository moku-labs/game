/**
 * @file Visual test: the settings popup of V3, opened by the gear of Home: the signboard hung on
 * its ropes, the three volume rows and the tabs.
 */
import { defineVisualTest } from "@moku-labs/game/testing";
import { atHome } from "./fixture";

export const settings = defineVisualTest("settings", {
  start: atHome,
  steps: [{ tap: { key: "homeSettings" } }, { checkpoint: "open" }]
});
