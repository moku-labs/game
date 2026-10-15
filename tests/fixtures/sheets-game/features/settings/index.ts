/**
 * @file The settings as a feature: one sheet over the shop.
 */
import { defineFeature } from "../../kit";
import { settingsSheet } from "./view";

export const settingsFeature = defineFeature("settings", { projections: [settingsSheet] });
