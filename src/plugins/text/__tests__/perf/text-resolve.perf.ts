import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { resolveFixture } from "./fixtures";

// X1: one call is one frame of the text system over 100 labels (80 plain, 20 bound), the world
// walk included, then the clear of phase `signals`.

/** A window ten times the default, so a stray compile weighs nothing in a frame that keeps a few bytes. */
const CALLS = 100_000;

describe("text resolve: heap per frame", () => {
  it("an idle frame over 100 labels, 20 bound, values unchanged, stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(resolveFixture("nothing"), CALLS);

    await annotate(`text resolve, idle: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textResolveIdle + NOISE_BYTES);
  }, 60_000);

  it("a frame where one bound value changes stays within budget", async ({ annotate }) => {
    const bytes = alloc(resolveFixture("value"), CALLS);

    await annotate(`text resolve, one bound value moving: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textResolveWorking + NOISE_BYTES);
  }, 60_000);

  it("a frame with one countdown label running stays within budget", async ({ annotate }) => {
    const bytes = alloc(resolveFixture("countdown"), CALLS);

    await annotate(`text resolve, one countdown running: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textResolveCountdown + NOISE_BYTES);
  }, 60_000);
});
