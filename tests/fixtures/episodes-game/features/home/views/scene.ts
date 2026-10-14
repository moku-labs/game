/**
 * @file The Home scene: the bundle of Home and the Home screen, on the `ui` layer every scene gets.
 */
import { defineScene } from "@core/kit";
import { homeScreen } from "./screen";

export const homeScene = defineScene("home", {
  bundle: "home",
  layers: {},
  projections: [homeScreen]
});
