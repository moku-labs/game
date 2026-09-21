import { describe, expect, it, vi } from "vitest";
import { teardown } from "../../../../teardown";
import { fakeClock } from "../../fake";
import { registerClockTeardown } from "../../lifecycle";
import type { ClockCtx, FakeClock, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: registerClockTeardown — the disposer reads state at stop time
// ---------------------------------------------------------------------------

const createMockCtx = (global: object): { ctx: ClockCtx; state: State; clock: FakeClock } => {
  const clock = fakeClock(1000);
  const state: State = {
    source: clock,
    last: 0,
    dueAt: undefined,
    handle: undefined,
    listeners: []
  };

  return { state, clock, ctx: { global, config: { source: clock }, state, emit: () => {} } };
};

describe("registerClockTeardown", () => {
  it("creates no timer at start", () => {
    const global = {};
    const { ctx, state, clock } = createMockCtx(global);
    const setTimer = vi.spyOn(clock, "setTimer");

    registerClockTeardown(ctx);

    expect(setTimer).not.toHaveBeenCalled();
    expect(state.handle).toBeUndefined();
  });

  it("clears the handle that exists at stop time, not the one at start time", async () => {
    const global = {};
    const { ctx, state, clock } = createMockCtx(global);
    const clearTimer = vi.spyOn(clock, "clearTimer");

    registerClockTeardown(ctx);
    const handle = clock.setTimer(() => {}, 1000);
    state.handle = handle;
    await teardown.run(global, "clock");

    expect(clearTimer).toHaveBeenCalledWith(handle);
  });

  it("forgets the due moment and the handle, so dueAt() reports nothing after stop", async () => {
    const global = {};
    const { ctx, state, clock } = createMockCtx(global);

    registerClockTeardown(ctx);
    state.handle = clock.setTimer(() => {}, 1000);
    state.dueAt = 2000;
    await teardown.run(global, "clock");

    expect(state.handle).toBeUndefined();
    expect(state.dueAt).toBeUndefined();
  });

  it("stops the pending timer from firing", async () => {
    const global = {};
    const { ctx, state, clock } = createMockCtx(global);
    const fired = vi.fn();

    registerClockTeardown(ctx);
    state.handle = clock.setTimer(fired, 1000);
    await teardown.run(global, "clock");
    clock.advance(5000);

    expect(fired).not.toHaveBeenCalled();
  });

  it("is harmless when no timer was ever created", async () => {
    const global = {};
    const { ctx } = createMockCtx(global);

    registerClockTeardown(ctx);

    await expect(teardown.run(global, "clock")).resolves.toBeUndefined();
  });
});
