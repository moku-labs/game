import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { lookCall } from "./look-moved.fixture";

describe("ui look check: heap per call", () => {
  it("compares each of the four visuals with the same look of a new render within budget", async ({
    annotate
  }) => {
    const bytes = bytesPerCall(lookCall());

    await annotate(`lookMoved, Shape, Sprite, NineSlice and Text, none moved: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.lookMoved + NOISE_BYTES);
  });
});
