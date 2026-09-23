/**
 * @file The splash scene: the splash screen with its loader, on the `ui` layer every scene gets. Its bundle is a boot bundle, so the splash draws before anything else has
 * loaded. It plays no music: the first gesture of the player has not unlocked the sound yet.
 */
import { defineScene } from "../../kit";
import { splashScreen } from "./view";

export const splashScene = defineScene("splash", {
  bundle: "splash",
  layers: {},
  projections: [splashScreen]
});
