/**
 * @file Visual test: the settings over the shop. With both, the energy and the gems fade with the settings; the
 * settings closed, the shop alone with its parts back; the shop closed.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atWard } from "./fixture";

export const sheetOverSheet = defineVisualTest("sheet-over-sheet", {
  start: atWard,
  steps: [
    { tap: { key: "shopButton" } },
    { step: { frames: 30 } },
    { tap: { key: "openSettings" } },
    { step: { frames: 8 } },
    { checkpoint: "both" },
    { tap: { key: "settingsClose" } },
    { step: { frames: 30 } },
    { checkpoint: "shop-alone" },
    { tap: { key: "shopDim" } },
    { step: { frames: 30 } },
    { checkpoint: "closed" }
  ],
  webgl: true
});
