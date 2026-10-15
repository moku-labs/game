/**
 * @file The inspection as a feature: one sheet over the ward.
 */
import { defineFeature } from "../../kit";
import { inspectSheet } from "./view";

export const inspectFeature = defineFeature("inspect", { projections: [inspectSheet] });
