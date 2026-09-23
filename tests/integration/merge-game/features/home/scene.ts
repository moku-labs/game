/**
 * @file The Home scene: the Home screen and the coin counter its pill hosts, on the `ui` layer
 * every scene gets, and the music of Home and the board: one key, so Play does not restart it.
 */
import { defineScene } from "../../kit";
import { hudCoins } from "../hud/coins";
import { homeScreen } from "./view";

export const homeScene = defineScene("home", {
  bundle: "home",
  music: "ui.theme",
  layers: {},
  projections: [homeScreen, hudCoins]
});
