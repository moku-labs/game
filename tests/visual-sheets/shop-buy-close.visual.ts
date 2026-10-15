/**
 * @file Visual test: the shop over the ward. It rises with the dim half way at 120 ms, rests landed, a purchase shows
 * the new count in the HUD and the new label under the dim in the same frame, and it closes: half way at 120 ms, gone.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atWard } from "./fixture";

export const shopBuyClose = defineVisualTest("shop-buy-close", {
  start: atWard,
  steps: [
    { tap: { key: "shopButton" } },
    { step: { frames: 7 } },
    { checkpoint: "rising" },
    { step: { frames: 30 } },
    { checkpoint: "landed" },
    { tap: { key: "buy" } },
    { step: { frames: 3 } },
    { checkpoint: "bought" },
    { tap: { key: "shopDim" } },
    { step: { frames: 7 } },
    { checkpoint: "closing" },
    { step: { frames: 30 } },
    { checkpoint: "gone" }
  ],
  webgl: true
});
