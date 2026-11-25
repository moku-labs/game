import { describe, expect, it, vi } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import type * as HostsModule from "../../jsx/hosts";
import { hostsMoved } from "../../jsx/hosts";
import type { JsxState } from "../../jsx/types";
import type { UiCtx } from "../../types";
import { PIECES } from "./app";
import { startPerfUi } from "./fixtures";

// ---------------------------------------------------------------------------
// Cold perf (change 2026-11-24-f230-hot-path, U3): the full hosting step, the hosts version moved before every call,
// while V8 runs the code unoptimized (`--max-opt=1`), as a phone runs it in its first seconds. Three hosts and the
// inset's slot; the first host names two projections of 40 views, the other two name projections that are not
// mounted: 80 hosted views and the inset's root. Measured on Node 24.21:
//   before the change   30 179 B a call (the iterators of the host set, the hosted map and the views of a projection)
//   now                  4 993 B a call, all of it inside `world.projection.entitiesOf`, the new list of views it hands
//                        out per name (public world API, kept as it is)
// ---------------------------------------------------------------------------

/** What the step costs cold now, 4 993 B, with room for the noise of unoptimized code: far under the 30 179 B before. */
const HOSTING_COLD = 5300;

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

describe("hosting step, run unoptimized", () => {
  it("walks 80 hosted views below what it cost before the change", async ({ annotate }) => {
    const ui = await startPerfUi();

    // Two projections of 40 views stay; the rest leave and their views go.
    ui.app.world.projection.unmount(PIECES.slice(2));

    for (let frame = 0; frame < 60; frame += 1) ui.app.time.step(16);

    const { step, ctx, state } = hosting;

    if (step === undefined || ctx === undefined || state === undefined) {
      throw new Error("perf: the hosting step never ran");
    }

    expect(state.hosts.size).toBe(4);
    expect(state.hosted.size).toBe(81);

    const bytes = allocCold(() => {
      hostsMoved(state);
      step(ctx, state);
    });

    await annotate(`hostViews, full walk, 80 views, cold: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(HOSTING_COLD);

    await ui.app.stop();
  });
});
