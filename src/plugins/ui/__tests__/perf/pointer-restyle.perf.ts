import { describe, expect, it } from "vitest";
import { views } from "./app";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, keyed, pressRelease, startPerfUi } from "./fixtures";

describe("pointer restyle: heap per press and release", () => {
  it("a press and a release on one button of a 200-element root stay within budget", async ({
    annotate
  }) => {
    const ui = await startPerfUi();
    const step = pressRelease(ui, keyed(ui, "hot"));
    const before = views.board;

    step();

    // The board's view does not run for a pointer flag.
    expect(views.board).toBe(before);

    // 30 000 presses keep some 115 MB: the window stays inside the 256 MB young generation.
    const bytes = bytesPerCall(step, 30_000);

    await annotate(`press + release, 200 elements: ${bytes} B a press`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.pressRelease + NOISE_BYTES);

    await ui.app.stop();
  });
});
