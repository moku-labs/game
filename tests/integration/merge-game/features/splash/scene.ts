/**
 * @file The splash scene: the splash screen and the saw blade its loader hosts, on the `ui` layer
 * every scene gets. Its bundle is a boot bundle, so the splash draws before anything else has
 * loaded. It plays no music: the first gesture of the player has not unlocked the sound yet.
 */
import { defineScene } from "../../kit";
import { splashBlade } from "./blade";
import { splashScreen } from "./view";

export const splashScene = defineScene("splash", {
  bundle: "splash",
  layers: {},
  projections: [splashScreen, splashBlade]
});
