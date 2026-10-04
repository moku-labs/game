/**
 * @file The Home scene: the Home screen, whose coin pill carries the counter, on the `ui` layer
 * every scene gets, and the music of Home and the board: one key, so Play does not restart it.
 */
import { defineScene } from "../../kit";
import { homeScreen } from "./view";

export const homeScene = defineScene("home", {
  bundle: "home",
  music: "ui.theme",
  layers: {},
  projections: [homeScreen]
});
