/**
 * @file The orders feature on the screen: the reward popup, the "Готово!" stamp a finished order
 * gets, and the bundle with the card, the rope and the sound a finished order plays. The flow half
 * of the same feature is `flows/reward.ts`, which contributes the popup sub-flow to the
 * `afterOrder` slot. The cards sway by the loop motion of their element (`motions.ts`).
 */
import { defineFeature } from "../../kit";
import { deliverStamp } from "./animations";
import { ordersAssets } from "./assets";
import { RewardPopup } from "./reward";

export const ordersFeature = defineFeature("orders", {
  ui: [RewardPopup],
  animations: [deliverStamp],
  assets: ordersAssets
});
