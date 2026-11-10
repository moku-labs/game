import { describe, expect, it } from "vitest";
import type { Events as LifecycleEvents } from "../../../lifecycle/types";
import { fakeClock } from "../../fake";
import { createHandlers } from "../../handlers";
import { createClockState } from "../../state";

// ---------------------------------------------------------------------------
// Unit test: the lifecycle:changed hook of the clock (F169)
// ---------------------------------------------------------------------------

type Changed = LifecycleEvents["lifecycle:changed"];

const changed = (reasons: Changed["reasons"]): Changed => ({
  reason: reasons[0] ?? "devtools",
  action: reasons.length > 0 ? "push" : "pop",
  reasons,
  paused: reasons.length > 0,
  resumed: reasons.length === 0
});

const setup = () => {
  const clock = fakeClock(1000);
  const state = createClockState({ config: { source: clock } });
  const hook = createHandlers({ state })["lifecycle:changed"];

  return { clock, state, hook };
};

describe("clock hook on lifecycle:changed", () => {
  it("stops the clock when the stack holds devtools among other reasons", () => {
    const { clock, state, hook } = setup();

    clock.advance(200);
    hook(changed(["background", "devtools"]));

    expect(state.frozenAt).toBe(1200);
  });

  it("leaves the clock on the source for a pause without devtools", () => {
    const { state, hook } = setup();

    hook(changed(["background"]));

    expect(state.frozenAt).toBeUndefined();
  });

  it("lets the clock go on, behind the source by the stand, when devtools leaves", () => {
    const { clock, state, hook } = setup();

    hook(changed(["devtools"]));
    clock.advance(700);
    hook(changed(["background"]));

    expect(state.frozenAt).toBeUndefined();
    expect(state.shift).toBe(-700);
  });
});
