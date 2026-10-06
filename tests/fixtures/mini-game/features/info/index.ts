/**
 * @file The info popup as a feature: its sub-flow, its popup component, the spark animation and
 * the spark emitter. The node that holds the sub-flow is `info` in the main flow.
 */
import { infoFlow } from "../../flows/info";
import { defineFeature } from "../../kit";
import { sparkBurst } from "./animations";
import { spark } from "./effects";
import { InfoPopup } from "./popup";

export const infoFeature = defineFeature("info", {
  flows: [infoFlow],
  ui: [InfoPopup],
  animations: [sparkBurst],
  emitters: [spark]
});
