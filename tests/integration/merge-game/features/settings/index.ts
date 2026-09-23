/**
 * @file The settings as a feature: the sub-flow behind the gear and its two popups, the settings
 * and the confirm stacked on them. The sub-flow is a node of the main flow (Home) and of the board
 * flow, because the gear sits on both screens.
 */
import { defineFeature } from "../../kit";
import { Confirm } from "./confirm";
import { settingsFlow } from "./flow";
import { Settings } from "./settings";

export const settingsFeature = defineFeature("settings", {
  flows: [settingsFlow],
  ui: [Settings, Confirm]
});
