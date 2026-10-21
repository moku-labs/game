import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { currentLabelFixture, resolveFixture } from "./fixtures";

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

  it("the step after the layout flush with no label added stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(resolveFixture("nothing", "added"), CALLS);

    await annotate(`text, step after the layout flush, nothing added: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textAddedIdle + NOISE_BYTES);
  }, 60_000);

  it("the phase that writes 20 labels resolved after the last flush once more stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(resolveFixture("nothing", "rewrite"), CALLS);

    await annotate(`text resolve, 20 labels written once more: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textRewrite + NOISE_BYTES);
  }, 60_000);

  // F50: a still screen of names that wrap at their box re-lays nothing and keeps nothing.
  it("an idle frame over 80 labels wrapped at their box stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(resolveFixture("nothing", "phase", "box"), CALLS);

    await annotate(`text resolve, idle, 80 wrapped at their box: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textResolveBoxIdle + NOISE_BYTES);
  }, 60_000);

  it("the update of a box label that shows its value already stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(currentLabelFixture(), CALLS);

    await annotate(`text adapter, box label written again as it is: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.textAdapterCurrent + NOISE_BYTES);
  }, 60_000);
});
