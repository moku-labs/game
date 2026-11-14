import { describe, expect, it } from "vitest";
import { Text } from "../../../text/components";
import { UiCounters } from "../../components";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, keyed, startTextWhenPerf } from "./fixtures";
import { remeasured, textWhenRemeasureCall } from "./text-when.fixture";

describe("ui texts whose key follows the frame (F182): heap per frame", () => {
  // Catches: a key resolved or an object built per frame for a text whose style names its key.
  it("an idle frame with ten when-keyed texts on a standing viewport builds nothing and solves nothing", async ({
    annotate
  }) => {
    const ui = await startTextWhenPerf();
    const counters = ui.app.world.ecs.resource(UiCounters);

    // The fixture holds: each text draws with the key of `when.portrait`.
    expect(ui.app.world.ecs.get(keyed(ui, "whenTitle0"), Text)?.style).toBe("perf.when.tall");

    const solves = counters.solves;
    const bytes = bytesPerCall(() => {
      ui.reconcile();
      ui.solve();
    });

    await annotate(`reconcile + solve, idle, 10 roots and 10 when-keyed texts: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textWhenIdle + NOISE_BYTES);
    expect(counters.solves).toBe(solves);

    await ui.app.stop();
  });

  // Catches: the key of the measure read by building something, not by a property read.
  it("the remeasure of a when-keyed text reads the frame's key and builds nothing", async ({
    annotate
  }) => {
    const bytes = bytesPerCall(textWhenRemeasureCall());

    expect(remeasured.style).toBe("perf.when.tall");

    await annotate(`remeasureShown, when-keyed text, size stands: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textWhenRemeasure + NOISE_BYTES);
  });
});
