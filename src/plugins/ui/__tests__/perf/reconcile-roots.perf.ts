import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, startPerfUi } from "./fixtures";

describe("ui reconcile and solve: heap per frame", () => {
  it("an idle frame over ten roots stays within budget", async ({ annotate }) => {
    const ui = await startPerfUi();
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, idle, 10 roots: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileIdle + NOISE_BYTES);

    await ui.app.stop();
  });
});
