import { describe, expect, it } from "vitest";
import type { FakeContainer } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, fadingLoader } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the step of the picture of a scene being left (F61 S3 slice A2) in a frame with no switch: what every frame of
// a game pays between its scene switches; and after a swap (F107 part 3), a frame of the fade-out, a loader layer fading
// with the veil, and a frame of its wait for the loader's views to leave.
// ---------------------------------------------------------------------------

/**
 * The layer `loading` of the mock, as the test reads it.
 *
 * @param mock - The mock.
 * @returns Its container.
 */
function loadingOf(mock: MockRenderer): FakeContainer {
  return mock.ctx.state.sync.layers.get("loading")?.container as unknown as FakeContainer;
}

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

  // Bug: a frame of the fade-out boxes the veil's level or the loader layer's alpha, or copies the look, every frame
  // of the 150 ms after each swap.
  it("allocates nothing a frame while a loader layer fades out with the veil", async () => {
    const fading = await fadingLoader("fade");
    const loading = loadingOf(fading.mock);

    expect(bytesPerCall(fading.step)).toBeLessThanOrEqual(BUDGET.leaveFade + NOISE);
    // Still the fade: the layer above the veil, part faded, the look not taken down.
    expect(loading.parent).toBe(fading.mock.ctx.state.sync.leave.objects?.held);
    expect(loading.alpha).toBeGreaterThan(0);
    expect(loading.alpha).toBeLessThan(1);
  });

  // Bug: a frame of the wait for the loader's views to leave walks or copies the layer every frame until the unmount.
  it("allocates nothing a frame while a loader layer waits for its views to leave", async () => {
    const waiting = await fadingLoader("wait");
    const loading = loadingOf(waiting.mock);

    expect(bytesPerCall(waiting.step)).toBeLessThanOrEqual(BUDGET.leaveWait + NOISE);
    // Still the wait: the layer above the veil at alpha 0, no look running.
    expect(loading.parent).toBe(waiting.mock.ctx.state.sync.leave.objects?.held);
    expect([loading.alpha, waiting.mock.ctx.state.sync.leave.run]).toEqual([0, undefined]);
  });
});
