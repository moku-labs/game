import { describe, expect, it } from "vitest";
import { fakeClock } from "../../fake";
import { createClockState } from "../../state";

// ---------------------------------------------------------------------------
// Unit test: createClockState
// ---------------------------------------------------------------------------

describe("createClockState", () => {
  it("takes the configured source", () => {
    const source = fakeClock(1000);

    const state = createClockState({ config: { source } });

    expect(state.source).toBe(source);
  });

  it("falls back to the system source when none is configured", () => {
    const state = createClockState({ config: { source: undefined } });

    expect(typeof state.source.now()).toBe("number");
    expect(typeof state.source.setTimer).toBe("function");
    expect(typeof state.source.clearTimer).toBe("function");
  });

  it("starts with no moment, no due moment, no timer and no listeners", () => {
    const state = createClockState({ config: { source: fakeClock(1000) } });

    expect(state.last).toBe(0);
    expect(state.dueAt).toBeUndefined();
    expect(state.handle).toBeUndefined();
    expect(state.listeners).toEqual([]);
  });

  it("gives every app its own listener list", () => {
    const source = fakeClock(1000);

    const first = createClockState({ config: { source } });
    const second = createClockState({ config: { source } });
    first.listeners.push(() => {});

    expect(second.listeners).toHaveLength(0);
  });
});
