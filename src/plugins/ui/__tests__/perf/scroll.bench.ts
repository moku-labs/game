import { bench, describe, vi } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import type { Time } from "../../../time/types";
import type { Element } from "../../jsx/types";
import type * as ScrollModule from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
import {
  aimSettle,
  flingFrame,
  glideFrame,
  glideMsSettle,
  heldFrame,
  jumpEndsGlideSettle,
  resizeReaimSettle,
  type ScrollCall,
  type ScrollPerf,
  type Step,
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

// The reconcile hands the scroll step its arguments: the bench calls the real step with them.
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

const scroll = await startScrollPerf(call);

/** The frame the running bench calls: each bench sets the strip up for its own in `setup`. */
const running: { frame: Step } = { frame: stillFrame(scroll) };

/**
 * The options of a bench whose `setup` builds its frame or settle, so the strip is held, flinging,
 * gliding or still when that bench starts, whatever the bench before it left.
 *
 * @param build - Sets the strip up and returns the frame.
 * @returns The options.
 */
function setUp(build: (perf: ScrollPerf) => Step) {
  return {
    ...BENCH_OPTIONS,
    setup: (): void => {
      running.frame = build(scroll);
    }
  };
}

describe("scroll step", () => {
  bench("held frame, one x strip", () => running.frame(), setUp(heldFrame));
  bench("fling frame, one x strip", () => running.frame(), setUp(flingFrame));
  bench("glide frame, one x strip", () => running.frame(), setUp(glideFrame));
  bench("still frame, one x strip", () => running.frame(), setUp(stillFrame));
});

describe("scroll settle", () => {
  bench("glideMs glide to a new offset, one x strip", () => running.frame(), setUp(glideMsSettle));
  bench("new aim, one x strip", () => running.frame(), setUp(aimSettle));
  bench(
    "jump ends a glide to the prop, one x strip",
    () => running.frame(),
    setUp(jumpEndsGlideSettle)
  );
  bench(
    "new range re-aims a glide to the prop, one x strip",
    () => running.frame(),
    setUp(resizeReaimSettle)
  );
});
