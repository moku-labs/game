import { afterEach, describe, expect, it, vi } from "vitest";
import type { Time } from "../../../time/types";
import type { Element } from "../../jsx/types";
import type * as ScrollModule from "../../layout/scroll";
import type { ElementLookup, LayoutState } from "../../layout/types";
import type { UiCtx } from "../../types";
import {
  find,
  mount,
  moveTo,
  press,
  release,
  type ScrollApp,
  startScrollApp,
  stateOf
} from "../scroll-app";

// ---------------------------------------------------------------------------
// Integration: A7 of change 2026-11-12-scroll-glide-control. A scroll nobody
// sees yet (`stands`: a root built aside or held warm) takes a new `aim` by
// standing at its `offset` prop at once. A held root can neither be dragged nor
// found by key, so the settle of the solve is called here with the arguments
// `ui` handed it and a `stands` that answers true.
// ---------------------------------------------------------------------------

/** What the settle of the solve was last called with. */
type SettleCall = {
  settle: typeof ScrollModule.settleScroll | undefined;
  ctx: UiCtx | undefined;
  state: LayoutState | undefined;
  containers: readonly Element[] | undefined;
  lookup: ElementLookup | undefined;
  time: Readonly<Time> | undefined;
};

/** The settle as `ui` calls it, and what it was last called with. */
const call = vi.hoisted(
  (): SettleCall => ({
    settle: undefined,
    ctx: undefined,
    state: undefined,
    containers: undefined,
    lookup: undefined,
    time: undefined
  })
);

// The solve hands the settle its context, state, containers, lookup and time: the test calls the
// real settle with them.
vi.mock("../../layout/scroll", async importOriginal => {
  const actual = await importOriginal<typeof ScrollModule>();

  call.settle = actual.settleScroll;

  return {
    ...actual,
    settleScroll: (...args: Parameters<typeof actual.settleScroll>): void => {
      [call.ctx, call.state, call.containers, call.lookup, call.time] = args;
      actual.settleScroll(...args);
    }
  };
});

/** The app of the running test, stopped after it. */
let running: ScrollApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

describe("aim on a scroll that stands", () => {
  it("A7: stands at the offset prop at once on a new aim, with no glide hidden", async () => {
    // Bug caught: a new aim on a scroll of a window held warm glides frame by frame while nobody
    // sees it, so the window opens with its strip still moving.
    running = await startScrollApp();
    mount(running, "aimed");

    const app = running;

    press(app, "glider", 500, 900);
    moveTo(app, -500, 900);
    app.time.step(16);
    app.time.step(16);
    app.time.step(16);
    release(app, "glider");

    expect(stateOf(app, "glider")).toEqual({ offset: 390, max: 390, moving: false });

    const { settle, ctx, state, containers, lookup, time } = call;
    const strip = containers?.find(container => container.entity === find(app, "glider"));

    if (
      settle === undefined ||
      ctx === undefined ||
      state === undefined ||
      lookup === undefined ||
      time === undefined ||
      strip === undefined
    ) {
      throw new Error("the settle never ran over the strip");
    }

    // The render of a held window brings the same offset, 0, and a new aim.
    strip.node.props.aim = "order-7";
    settle(ctx, state, [strip], lookup, time, () => true);

    expect(stateOf(app, "glider")).toEqual({ offset: 0, max: 390, moving: false });
  });
});
