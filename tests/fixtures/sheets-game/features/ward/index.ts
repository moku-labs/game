/**
 * @file The ward as a feature: its scene and root, the text style of the counters and the boot bundle `ui`.
 */
import { defineFeature } from "../../kit";
import { uiAssets } from "../ui/assets";
import { wardScene } from "./scene";
import { countStyles } from "./styles";
import { wardRoot } from "./view";

export const wardFeature = defineFeature("ward", {
  scenes: [wardScene],
  projections: [wardRoot],
  textStyles: countStyles,
  assets: uiAssets
});
