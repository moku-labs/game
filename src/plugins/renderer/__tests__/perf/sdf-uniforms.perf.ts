import { describe, expect, it } from "vitest";
import { sdfSyncStage } from "../sdf-text-stage";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the local uniforms of 20 distance-field texts synced into a frame's uniform buffer by Pixi's generated function
// over the real pixi.js (E1 of change 2026-10-18-render-path-garbage): every text's `uDistance` is read through the
// renderer's accessor, one pair shared by every text, so the function stays monomorphic and nothing is boxed.
// ---------------------------------------------------------------------------

describe("the uniform sync of SDF texts", () => {
  it("allocates nothing for 20 texts a frame", () => {
    expect(bytesPerCall(sdfSyncStage(20), 20_000)).toBeLessThanOrEqual(
      BUDGET.sdfUniformsSync + NOISE
    );
  });
});
