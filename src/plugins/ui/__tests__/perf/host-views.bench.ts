import { bench, describe, vi } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import type * as HostsModule from "../../jsx/hosts";
import type { JsxState } from "../../jsx/types";
import type { UiCtx } from "../../types";
import { startPerfUi } from "./fixtures";

/** The hosting step as `ui` calls it, and what it was last called with. */
const hosting = vi.hoisted(() => ({
  step: undefined as typeof HostsModule.hostViews | undefined,
  ctx: undefined as UiCtx | undefined,
  state: undefined as JsxState | undefined
}));

// The reconcile hands the hosting step its context and state: the bench calls the real step with them.
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

await startPerfUi();

const { step, ctx, state } = hosting;

if (step === undefined || ctx === undefined || state === undefined) {
  throw new Error("perf: the hosting step never ran");
}

describe("hosting step", () => {
  bench("idle frame, 3 hosts × 2 names × 40 views", () => step(ctx, state), BENCH_OPTIONS);
});
