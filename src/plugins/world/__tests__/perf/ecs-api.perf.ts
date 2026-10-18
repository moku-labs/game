import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { ecsCallsFixture } from "./fixtures";

describe("ecs calls a game makes every frame: heap per call", () => {
  it("ecs.get stays within budget", async ({ annotate }) => {
    const bytes = alloc(ecsCallsFixture().get);

    await annotate(`ecs.get: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsGet + NOISE_BYTES);
  });

  it("ecs.set of one double field stays within budget, the caller's patch kept by the caller", async ({
    annotate
  }) => {
    const bytes = alloc(ecsCallsFixture().set);

    await annotate(`ecs.set: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsSet + NOISE_BYTES);
  });

  it("ecs.set of three double fields stays within budget", async ({ annotate }) => {
    const bytes = alloc(ecsCallsFixture().setThree);

    await annotate(`ecs.set, three doubles: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsSetThree + NOISE_BYTES);
  });

  it("ecs.set of one integer field stays within budget", async ({ annotate }) => {
    const bytes = alloc(ecsCallsFixture().setInteger);

    await annotate(`ecs.set, integer: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsSetInteger + NOISE_BYTES);
  });

  it("ecs.has stays within budget", async ({ annotate }) => {
    const bytes = alloc(ecsCallsFixture().has);

    await annotate(`ecs.has: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsHas + NOISE_BYTES);
  });

  it("ecs.resource(Now), as res(Now), stays within budget", async ({ annotate }) => {
    const bytes = alloc(ecsCallsFixture().res);

    await annotate(`ecs.resource(Now): ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.ecsRes + NOISE_BYTES);
  });
});
