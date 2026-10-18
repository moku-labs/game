import { describe, expect, it, vi } from "vitest";
import type * as HostsModule from "../../jsx/hosts";
import type { JsxState } from "../../jsx/types";
import type { UiCtx } from "../../types";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { bytesPerCall, startPerfUi } from "./fixtures";

/** The hosting step as `ui` calls it, and what it was last called with. */
const hosting = vi.hoisted(() => ({
  step: undefined as typeof HostsModule.hostViews | undefined,
  ctx: undefined as UiCtx | undefined,
  state: undefined as JsxState | undefined
}));

// The reconcile hands the hosting step its context and state: the window calls the real step with them.
vi.mock("../../jsx/hosts", async importOriginal => {
  const actual = await importOriginal<typeof HostsModule>();

  hosting.step = actual.hostViews;

  return {
    ...actual,
    hostViews: (ctx: UiCtx, state: JsxState, only?: ReadonlySet<number>): void => {
      hosting.ctx = ctx;
      hosting.state = state;
      actual.hostViews(ctx, state, only);
    }
  };
});

describe("hosting step: heap per frame", () => {
  it("an idle frame of three hosts of two projections of 40 views stays within budget", async ({
    annotate
  }) => {
    const ui = await startPerfUi();
    const { step, ctx, state } = hosting;

    if (step === undefined || ctx === undefined || state === undefined) {
      throw new Error("perf: the hosting step never ran");
    }

    // Three hosts and the inset's slot; 6 × 40 views and the inset's root are hosted.
    expect(state.hosts.size).toBe(4);
    expect(state.hosted.size).toBe(241);

    const bytes = bytesPerCall(() => step(ctx, state));

    await annotate(`hostViews, idle, 3 hosts × 2 names × 40 views: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.hostViewsIdle + NOISE_BYTES);

    await ui.app.stop();
  });
});
