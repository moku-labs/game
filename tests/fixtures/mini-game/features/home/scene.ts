/**
 * @file The Home scene: the bundle of the interface and the Home screen, on the `ui` layer every
 * scene gets.
 */
import { defineScene } from "../../kit";
import { homeScreen } from "./view";

export const homeScene = defineScene("home", {
  bundle: "ui",
  layers: {},
  projections: [homeScreen]
});
