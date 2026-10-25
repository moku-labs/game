import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { lookWriteCall } from "./look-write.fixture";

describe("ui look write: heap per call", () => {
  it("writes the XP arc's new sweep for its change hook within budget", async ({ annotate }) => {
    const bytes = bytesPerCall(lookWriteCall());

    await annotate(`writeLook, an arc's sweep moved, the hook plays: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.lookWrite + NOISE_BYTES);
  });
});
