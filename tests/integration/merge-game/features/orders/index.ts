/**
 * @file The orders feature on the screen: the reward popup, the delivery animation and the
 * bundle with the sound a finished order plays. The flow half of the same feature is
 * `flows/reward.ts`, which contributes the popup sub-flow to the `afterOrder` slot.
 */
import { defineFeature } from "../../kit";
import { deliverOrder } from "./animations";
import { ordersAssets } from "./assets";
import { RewardPopup } from "./reward";

export const ordersFeature = defineFeature("orders", {
  ui: [RewardPopup],
  animations: [deliverOrder],
  assets: ordersAssets
});
