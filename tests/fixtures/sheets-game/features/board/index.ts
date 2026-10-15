/**
 * @file The board as a feature: its scene and root.
 */
import { defineFeature } from "../../kit";
import { boardScene } from "./scene";
import { boardRoot } from "./view";

export const boardFeature = defineFeature("board", {
  scenes: [boardScene],
  projections: [boardRoot]
});
