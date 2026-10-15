/**
 * @file Visual test: the inspection over the ward. Open, its page open over it, the page closed, and the way back: at
 * 200 ms and at 340 ms the window still flies over the picture of the ward, and after it the ward is live.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atWard } from "./fixture";

export const inspectionPage = defineVisualTest("inspection-page", {
  start: atWard,
  steps: [
    { tap: { key: "wardObject" } },
    { step: { frames: 30 } },
    { checkpoint: "open" },
    { tap: { key: "openPage" } },
    { step: { frames: 3 } },
    { checkpoint: "page" },
    { tap: { key: "inspectBack" } },
    { step: { frames: 12 } },
    { checkpoint: "back-200" },
    { step: { frames: 8 } },
    { checkpoint: "back-340" },
    { step: { frames: 10 } },
    { checkpoint: "after" }
  ],
  webgl: true
});
