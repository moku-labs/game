import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { remeasureCall } from "./remeasure-bound.fixture";

describe("ui remeasure of a bound text: heap per call", () => {
  it("builds nothing for a built-in bind, whose size stands", async ({ annotate }) => {
    const bytes = bytesPerCall(remeasureCall());

    await annotate(`remeasureShown, built-in bind, size stands: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.remeasureBound + NOISE_BYTES);
  });
});
