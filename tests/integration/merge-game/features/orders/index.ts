/**
 * @file The orders feature on the screen: the reward popup, the "Готово!" stamp a finished order
 * gets, the swings of the cards on the rope, and the bundle with the card, the rope and the sound
 * a finished order plays. The flow half of the same feature is `flows/reward.ts`, which
 * contributes the popup sub-flow to the `afterOrder` slot. The swings are played by
 * `boardLookPlugin`, which has `anim` in hand.
 */
import { defineFeature } from "../../kit";
import { deliverStamp } from "./animations";
import { ordersAssets } from "./assets";
import { cardSways } from "./motions";
import { RewardPopup } from "./reward";

export const ordersFeature = defineFeature("orders", {
  ui: [RewardPopup],
  animations: [
    deliverStamp,
    cardSways.waiting,
    cardSways.waitingMirrored,
    cardSways.ready,
    cardSways.readyMirrored
  ],
  assets: ordersAssets
});
