import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Time } from "../../../time/types";
import type { Element } from "../../jsx/types";
import type * as ScrollModule from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
import { BUDGET, NOISE_BYTES } from "./budgets";
import {
  aimSettle,
  bytesPerCall,
  flingFrame,
  glideFrame,
  glideMsSettle,
  heldFrame,
  jumpEndsGlideSettle,
  jumpFrame,
  resizeReaimSettle,
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

  it("a jump settle stays within budget", async ({ annotate }) => {
    const jump = bytesPerCall(jumpFrame(scroll));

    await annotate(`settleScroll, jump: ${jump} B a render`);
    expect(jump).toBeLessThanOrEqual(BUDGET.scrollJump + NOISE_BYTES);
    // The window measured the jump: the strip stands on the last prop, no glide started.
    expect(scroll.motion.mode).toBe("still");
    expect(scroll.motion.offset).toBe(scroll.element.node.props.offset);
  });

  it("a settle that starts a glide of glideMs to a new offset stays within budget", async ({
    annotate
  }) => {
    const glideMs = bytesPerCall(glideMsSettle(scroll));

    await annotate(`settleScroll, glideMs: ${glideMs} B a render`);
    expect(glideMs).toBeLessThanOrEqual(BUDGET.scrollGlideMsSettle + NOISE_BYTES);
    // The window measured the glide: 150 ms from 900 to the last prop.
    expect(scroll.motion).toMatchObject({ mode: "glide", from: 900, duration: 150 });
  });

  it("a settle with a new aim stays within budget", async ({ annotate }) => {
    const aim = bytesPerCall(aimSettle(scroll));

    await annotate(`settleScroll, aim: ${aim} B a render`);
    expect(aim).toBeLessThanOrEqual(BUDGET.scrollAimSettle + NOISE_BYTES);
    // The window measured the follow: a glide from 900 to the same prop, 1000.
    expect(scroll.motion).toMatchObject({ mode: "glide", from: 900, to: 1000, duration: 150 });
  });

  it("a settle whose jump ends a glide to the prop stays within budget", async ({ annotate }) => {
    const jump = bytesPerCall(jumpEndsGlideSettle(scroll));

    await annotate(`settleScroll, jump ends a glide: ${jump} B a render`);
    expect(jump).toBeLessThanOrEqual(BUDGET.scrollJumpEndsGlide + NOISE_BYTES);
    expect(scroll.motion).toMatchObject({ mode: "still", offset: 1000 });
  });

  it("a settle whose new range re-aims a glide to the prop stays within budget", async ({
    annotate
  }) => {
    const reaim = bytesPerCall(resizeReaimSettle(scroll));

    await annotate(`settleScroll, re-aim: ${reaim} B a render`);
    expect(reaim).toBeLessThanOrEqual(BUDGET.scrollResizeReaim + NOISE_BYTES);
    // The window measured the re-aim: the range of the strip, a glide of 150 ms from 950.
    expect(scroll.motion).toMatchObject({ mode: "glide", from: 950, duration: 150 });
    expect(scroll.motion.max).not.toBe(5000);
  });
});
