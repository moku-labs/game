/**
 * @file Home as a feature: its scene, its screen and its bundle. The node it is shown on is
 * `nodes/home.ts`, in the main flow; a headless test composes nothing of this.
 */
import { defineFeature } from "../../kit";
import { homeAssets } from "./assets";
import { homeScene } from "./scene";
import { homeScreen } from "./view";

export const homeFeature = defineFeature("home", {
  scenes: [homeScene],
  projections: [homeScreen],
  assets: homeAssets
});
