/**
 * @file Leaving the game as a feature: the popup Back on Home opens, and the plugin that hands its
 * `exit` effect to the app. The node that shows the popup is `nodes/leave-game.ts`, in the main
 * flow; its strings live next to this file.
 */
import { defineFeature } from "../../kit";
import { Leave } from "./leave";

export const leaveFeature = defineFeature("leave", { ui: [Leave] });
