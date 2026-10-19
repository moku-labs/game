import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Time } from "../../../time/types";
import type { Element } from "../../jsx/types";
import type * as ScrollModule from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
import { BUDGET, NOISE_BYTES } from "./budgets";
import {
  bytesPerCall,
  flingFrame,
  glideFrame,
  heldFrame,
  type ScrollCall,
  startScrollPerf,
  stillFrame
} from "./fixtures";

/** The scroll step as `ui` calls it, and what it was last called with. */
const call = vi.hoisted(
  (): ScrollCall => ({
    step: undefined,
    ctx: undefined,
    state: undefined,
    containers: undefined,
    lookup: undefined
  })
);

// The reconcile hands the scroll step its context, state, containers and lookup: the window
// calls the real step with them.
vi.mock("../../layout/scroll", async importOriginal => {
  const actual = await importOriginal<typeof ScrollModule>();

  call.step = actual.stepScroll;

  return {
    ...actual,
    stepScroll: (
      ctx: UiCtx,
      state: LayoutState,
      containers: readonly Element[],
      lookup: ElementLookup,
      time: Readonly<Time>
    ): void => {
      call.ctx = ctx;
      call.state = state;
      call.containers = containers;
      call.lookup = lookup;
      actual.stepScroll(ctx, state, containers, lookup, time);
    }
  };
});

/** The started perf app the four frame kinds share. */
type ScrollPerf = Awaited<ReturnType<typeof startScrollPerf>>;

describe("scroll step: heap per frame of one x strip", () => {
  let scroll: ScrollPerf;

  beforeAll(async () => {
    scroll = await startScrollPerf(call);
  });

  afterAll(async () => {
    await scroll.ui.app.stop();
  });

  it("a held frame stays within budget", async ({ annotate }) => {
    const held = bytesPerCall(heldFrame(scroll));

    await annotate(`stepScroll, held: ${held} B a frame`);
    expect(held).toBeLessThanOrEqual(BUDGET.scrollHeld + NOISE_BYTES);
  });

  it("a flinging frame stays within budget", async ({ annotate }) => {
    const fling = bytesPerCall(flingFrame(scroll));

    await annotate(`stepScroll, fling: ${fling} B a frame`);
    expect(fling).toBeLessThanOrEqual(BUDGET.scrollFling + NOISE_BYTES);
  });

  it("a gliding frame stays within budget", async ({ annotate }) => {
    const glide = bytesPerCall(glideFrame(scroll));

    await annotate(`stepScroll, glide: ${glide} B a frame`);
    expect(glide).toBeLessThanOrEqual(BUDGET.scrollGlide + NOISE_BYTES);
  });

  it("a still frame stays within budget", async ({ annotate }) => {
    const still = bytesPerCall(stillFrame(scroll));

    await annotate(`stepScroll, still: ${still} B a frame`);
    expect(still).toBeLessThanOrEqual(BUDGET.scrollStill + NOISE_BYTES);
  });
});
