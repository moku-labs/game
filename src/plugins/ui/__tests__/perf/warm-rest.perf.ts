import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, startWarmPerf } from "./fixtures";

describe("ui with windows held warm: heap per frame at rest", () => {
  it("runs the reconcile and the solve of a frame at rest within budget", async ({ annotate }) => {
    const ui = await startWarmPerf();
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, ten roots and two held warm: ${bytes} B a frame`);
    // The sheets are held: `find` does not answer them.
    expect(ui.app.ui.find("shopMarket")).toBeUndefined();
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileWarmRest + NOISE_BYTES);

    await ui.app.stop();
  });

  it("keeps the enters of the held windows in ui.enter within budget", async ({ annotate }) => {
    const ui = await startWarmPerf();
    const bytes = bytesPerCall(ui.enter);

    await annotate(`ui.enter, two windows held warm: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.enterWarmRest + NOISE_BYTES);

    await ui.app.stop();
  });
});
