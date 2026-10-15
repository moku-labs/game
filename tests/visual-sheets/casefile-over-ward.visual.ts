/**
 * @file Visual test: the case file over the ward. Landed, the ward is not drawn at all; sixty frames later (the glints
 * would have moved) the same pixels; at its first exit frame the ward is live again.
 */
import { defineVisualTest } from "@moku-labs/game/visual";
import { atWard } from "./fixture";

export const casefileOverWard = defineVisualTest("casefile-over-ward", {
  start: atWard,
  steps: [
    { tap: { key: "wardCase" } },
    { step: { frames: 30 } },
    { checkpoint: "landed" },
    { step: { frames: 60 } },
    { checkpoint: "still" },
    { tap: { key: "caseClose" } },
    { step: { frames: 1 } },
    { checkpoint: "leaving" }
  ],
  webgl: true
});
