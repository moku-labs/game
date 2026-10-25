import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { buildCallsFixture } from "./fixtures";

// F61 S2: ui and renderer read these every frame, idle or while the next scene builds; scenes polls `built()` in its
// `signals` callback, and world's `input` callback starts the frame budget. None may allocate.
describe("scene build frame calls: heap per call", () => {
  const idle = buildCallsFixture(false);
  const building = buildCallsFixture(true);

  it("projection.left() keeps nothing, idle and while a build runs", async ({ annotate }) => {
    const idleBytes = alloc(idle.left);
    const bytes = alloc(building.left);

    await annotate(`left: ${idleBytes} B idle, ${bytes} B building`);
    expect(idleBytes).toBeLessThanOrEqual(BUDGET.buildLeftIdle + NOISE_BYTES);
    expect(bytes).toBeLessThanOrEqual(BUDGET.buildLeft + NOISE_BYTES);
  });

  it("projection.isBuilding(entity) keeps nothing, idle and while a build of 300 views runs", async ({
    annotate
  }) => {
    const idleBytes = alloc(idle.isBuilding);
    const bytes = alloc(building.isBuilding);

    await annotate(`isBuilding: ${idleBytes} B idle, ${bytes} B building`);
    expect(idleBytes).toBeLessThanOrEqual(BUDGET.buildIsBuildingIdle + NOISE_BYTES);
    expect(bytes).toBeLessThanOrEqual(BUDGET.buildIsBuilding + NOISE_BYTES);
  });

  it("projection.built() keeps nothing, idle and over two checks", async ({ annotate }) => {
    const idleBytes = alloc(idle.built);
    const bytes = alloc(building.built);

    await annotate(`built: ${idleBytes} B idle, ${bytes} B building`);
    expect(idleBytes).toBeLessThanOrEqual(BUDGET.buildBuiltIdle + NOISE_BYTES);
    expect(bytes).toBeLessThanOrEqual(BUDGET.buildBuilt + NOISE_BYTES);
  });

  it("the frame start of phase input keeps nothing, idle and while a build runs", async ({
    annotate
  }) => {
    const idleBytes = alloc(idle.startFrame);
    const bytes = alloc(building.startFrame);

    await annotate(`startFrame: ${idleBytes} B idle, ${bytes} B building`);
    expect(idleBytes).toBeLessThanOrEqual(BUDGET.buildStartFrameIdle + NOISE_BYTES);
    expect(bytes).toBeLessThanOrEqual(BUDGET.buildStartFrame + NOISE_BYTES);
  });
});
