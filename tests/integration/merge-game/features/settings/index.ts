/**
 * @file The settings as a feature: the screen component and the three nodes behind it. The nodes
 * are wired into the board flow, because the gear sits in the HUD of the board.
 */
import { defineFeature } from "../../kit";
import { openSettings, setLocale, setVolume } from "./nodes";
import { Settings } from "./settings";

export const settingsFeature = defineFeature("settings", {
  nodes: [openSettings, setVolume, setLocale],
  ui: [Settings]
});
