import { describe, expect, it } from "vitest";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, startPerfUi } from "./fixtures";

describe("ui enter queue: heap per frame", () => {
  it("queues an element at its Box and drains the queue in ui.enter within budget", async ({
    annotate
  }) => {
    const ui = await startPerfUi();
    // An element of the board that entered long ago: its enter plays nothing again, so the window
    // holds only the queue's own work.
    const row = ui.app.ui.find("r0") ?? 0;
    const bytes = bytesPerCall(() => {
      ui.boxed(row);
      ui.enter();
    });

    await annotate(`Box queued + ui.enter, one element: ${bytes} B a frame`);
    expect(row).not.toBe(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.enterQueue + NOISE_BYTES);

    await ui.app.stop();
  });
});
