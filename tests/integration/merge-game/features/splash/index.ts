/**
 * @file The splash as a feature: its scene, its screen, the saw blade of the loader with the
 * system that spins it, and its bundle. The loading itself is the plugin next to it (`plugin.ts`),
 * composed by the game with the screen; the node it is shown on is `nodes/splash.ts`, in the main
 * flow.
 */
import { defineFeature } from "../../kit";
import { splashAssets } from "./assets";
import { Blade, spinBlade, splashBlade } from "./blade";
import { splashScene } from "./scene";
import { splashScreen } from "./view";

export const splashFeature = defineFeature("splash", {
  scenes: [splashScene],
  projections: [splashScreen, splashBlade],
  systems: [spinBlade],
  components: [Blade],
  assets: splashAssets
});
