import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { stillCall } from "./exit-still.fixture";
import { bytesPerCall } from "./fixtures";

describe("ui exit sweep: heap per call", () => {
  it("asks one leaving element with an endless motion whether it is still, within budget", async ({
    annotate
  }) => {
    const bytes = bytesPerCall(stillCall());

    await annotate(`still, three motions, one endless: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.exitStill + NOISE_BYTES);
  });
});
