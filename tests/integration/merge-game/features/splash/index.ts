/**
 * @file The splash as a feature: its scene, its screen and its bundle. The loading itself is the
 * plugin next to it (`plugin.ts`), composed by the game with the screen; the node it is shown on
 * is `nodes/splash.ts`, in the main flow.
 */
import { defineFeature } from "../../kit";
import { splashAssets } from "./assets";
import { splashScene } from "./scene";
import { splashScreen } from "./view";

export const splashFeature = defineFeature("splash", {
  scenes: [splashScene],
  projections: [splashScreen],
  assets: splashAssets
});
