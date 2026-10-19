import { describe, expect, it, vi } from "vitest";
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

describe("scroll step: heap per frame", () => {
  it("a held, a flinging, a gliding and a still frame of the order strip stay within budget", async ({
    annotate
  }) => {
    const scroll = await startScrollPerf(call);

    const held = bytesPerCall(heldFrame(scroll));
    const fling = bytesPerCall(flingFrame(scroll));
    const glide = bytesPerCall(glideFrame(scroll));
    const still = bytesPerCall(stillFrame(scroll));

    await annotate(
      `stepScroll, one x strip: held ${held} B, fling ${fling} B, glide ${glide} B, still ${still} B a frame`
    );
    expect(held).toBeLessThanOrEqual(BUDGET.scrollHeld + NOISE_BYTES);
    expect(fling).toBeLessThanOrEqual(BUDGET.scrollFling + NOISE_BYTES);
    expect(glide).toBeLessThanOrEqual(BUDGET.scrollGlide + NOISE_BYTES);
    expect(still).toBeLessThanOrEqual(BUDGET.scrollStill + NOISE_BYTES);

    await scroll.ui.app.stop();
  });
});
