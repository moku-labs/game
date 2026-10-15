/**
 * @file The case file as a feature: one opaque sheet over the ward.
 */
import { defineFeature } from "../../kit";
import { casefileSheet } from "./view";

export const casefileFeature = defineFeature("casefile", { projections: [casefileSheet] });
