import { describe, expect, it } from "vitest";
import { createMockRenderer } from "../mock-renderer";
import { startShots } from "../shots-gpu";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: what every frame of a game pays for the shots: `shots.after` right after the stage render, with nothing wanted.
// A take itself may allocate: it runs once per switch (spike on the A26: GPU 1.8 ms, main thread 1.5 ms).
// ---------------------------------------------------------------------------

describe("shots.after", () => {
  // Bug: the after-frame step makes a list, a closure or a canvas read every frame of a game that declared shots.
  it("allocates nothing a frame with nothing wanted", async () => {
    const { mock } = await startShots();

    // One shot taken: what a game holds between its switches.
    mock.api.shots.take("shot.room");
    mock.runPhase("render");
    mock.runPhase("render");

    expect(mock.api.shots.has("shot.room")).toBe(true);
    expect(bytesPerCall(() => mock.modules.shots.after(true))).toBeLessThanOrEqual(
      BUDGET.shotsIdle + NOISE
    );
  });

  // Bug: a game without `shots` pays for a feature it never declared.
  it("allocates nothing a frame without shots in the config", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(bytesPerCall(() => mock.modules.shots.after(true))).toBeLessThanOrEqual(
      BUDGET.shotsOff + NOISE
    );
  });
});
