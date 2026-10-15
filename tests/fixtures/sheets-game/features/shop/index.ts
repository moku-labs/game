/**
 * @file The shop as a feature: its sub-flow and its sheet, mounted by both scenes.
 */
import { shoppingFlow } from "../../flows/shopping";
import { defineFeature } from "../../kit";
import { shopSheet } from "./view";

export const shopFeature = defineFeature("shop", {
  flows: [shoppingFlow],
  projections: [shopSheet]
});
