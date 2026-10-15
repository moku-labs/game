/**
 * @file The HUD as a feature: one projection, mounted by both scenes.
 */
import { defineFeature } from "../../kit";
import { hudBar } from "./view";

export const hudFeature = defineFeature("hud", { projections: [hudBar] });
