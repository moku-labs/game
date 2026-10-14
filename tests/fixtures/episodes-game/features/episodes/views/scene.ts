/**
 * @file The picker scene: the bundle of the episodes and the picker screen.
 */
import { defineScene } from "@core/kit";
import { pickerScreen } from "./picker";

export const pickerScene = defineScene("picker", {
  bundle: "episodes",
  layers: {},
  projections: [pickerScreen]
});
