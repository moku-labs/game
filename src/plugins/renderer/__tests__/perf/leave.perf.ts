import { describe, expect, it } from "vitest";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the step of the picture of a scene being left (F61 S3 slice A2) in a frame with no switch: what every frame of
// a game pays between its scene switches.
// ---------------------------------------------------------------------------

describe("the step of the picture of a scene being left", () => {
  // Bug: an idle step walks the stage, reads the clock or places the kept objects every frame.
  it("allocates nothing a frame while no switch runs", async () => {
    const mock = createMockRenderer();

    await mock.start();
    // One look shown, drawn and dropped: its objects are kept for the next switch.
    mock.api.sync.leave.show({
      cover: { color: 0, alpha: 0.45, inMs: 150, outMs: 150 },
      loader: { afterMs: 0 }
    });
    mock.runPhase("render");
    mock.api.sync.leave.drop();

    expect(mock.ctx.state.sync.leave.objects).toBeDefined();
    expect(bytesPerCall(() => mock.modules.sync.stepLeave())).toBeLessThanOrEqual(
      BUDGET.leaveIdle + NOISE
    );
  });
});
