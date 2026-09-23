/**
 * @file The Home scene: the Home screen and the coin counter its pill hosts. Only the `ui` layer,
 * which every scene gets.
 */
import { defineScene } from "../../kit";
import { hudCoins } from "../hud/coins";
import { homeScreen } from "./view";

export const homeScene = defineScene("home", {
  bundle: "home",
  layers: {},
  projections: [homeScreen, hudCoins]
});
