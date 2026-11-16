import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { fadeMount } from "./fade-mount.fixture";
import { bytesPerCall } from "./fixtures";

describe("ui overlay fade from its mount frame (F205): heap per mount", () => {
  it("writes the level and hands back the rest of the track within budget", async ({
    annotate
  }) => {
    const bytes = bytesPerCall(fadeMount());

    await annotate(`fade from the mount frame: ${bytes} B a mount`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.fadeMount + NOISE_BYTES);
  });
});
