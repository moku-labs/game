import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { mutedFixture } from "./fixtures";

describe("muted fields: heap per frame", () => {
  it("50 unmuted tracks asking for their muted fields stay within budget", async ({ annotate }) => {
    const bytes = alloc(mutedFixture(false), 2000);

    await annotate(`muted, 50 unmuted tracks: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.mutedUnmuted + NOISE_BYTES);
  });

  it("50 muted tracks of a component with an owned field stay within budget", async ({
    annotate
  }) => {
    const bytes = alloc(mutedFixture(true), 2000);

    await annotate(`muted, 50 muted + owned tracks: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.mutedOwned + NOISE_BYTES);
  });
});
