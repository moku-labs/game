import { describe, expect, it } from "vitest";
import { Text } from "../../../text/components";
import { UiCounters } from "../../components";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, keyed, startBoxPerf, startPerfUi } from "./fixtures";

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

  // F50: names that wrap at their box ask for no measure and no solve on a still frame.
  it("an idle frame with eight names wrapped at their box stays within budget", async ({
    annotate
  }) => {
    const ui = await startBoxPerf();
    const counters = ui.app.world.ecs.resource(UiCounters);

    // The fixture holds: each name is laid out at the 200 its row leaves it.
    expect(ui.app.world.ecs.get(keyed(ui, "boxName0"), Text)?.box).toBe(200);

    const solves = counters.solves;
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, idle, 10 roots and 8 box names: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.reconcileBoxIdle + NOISE_BYTES);
    expect(counters.solves).toBe(solves);

    await ui.app.stop();
  });
});
