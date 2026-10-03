/**
 * @file The settings as a feature: the sub-flow behind the gear and its three popups, the settings
 * and the confirm and the rename stacked on them. The sub-flow is a node of the main flow (Home)
 * and of the board flow, because the gear sits on both screens.
 */
import { defineFeature } from "../../kit";
import { Confirm } from "./confirm";
import { settingsFlow } from "./flow";
import { Rename } from "./rename";
import { Settings } from "./settings";

export const settingsFeature = defineFeature("settings", {
  flows: [settingsFlow],
  ui: [Settings, Confirm, Rename]
});
