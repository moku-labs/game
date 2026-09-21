import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { cancelPending, createClockApi } from "../../api";
import { fakeClock } from "../../fake";
import type { ClockCtx, ClockSource, Elapsed, FakeClock, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createClockApi (mock context, no kernel)
// ---------------------------------------------------------------------------

const createMockCtx = (source: ClockSource): ClockCtx => ({
  global: {},
  config: { source },
  state: { source, last: 0, dueAt: undefined, handle: undefined, listeners: [] },
  emit: () => {}
});

const createFakeCtx = (start = 1000): { ctx: ClockCtx; clock: FakeClock } => {
  const clock = fakeClock(start);
  return { clock, ctx: createMockCtx(clock) };
};

describe("createClockApi", () => {
  describe("now", () => {
    it("returns the moment of the source", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      expect(api.now()).toBe(1000);
    });

    it("follows the source forward", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);

      api.now();
      clock.advance(500);

      expect(api.now()).toBe(1500);
    });

    it("never goes back when the device clock is moved back", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);

      expect(api.now()).toBe(1000);
      clock.set(400);

      expect(api.now()).toBe(1000);
    });

    it("keeps the high-water mark after the source catches up again", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);

      api.now();
      clock.set(400);
      api.now();
      clock.set(1200);

      expect(api.now()).toBe(1200);
    });

    it("returns an integer for a source that reports a fraction", () => {
      const source: ClockSource = {
        now: () => 1000.7,
        setTimer: () => undefined,
        clearTimer: () => {}
      };
      const api = createClockApi(createMockCtx(source));

      expect(api.now()).toBe(1000);
    });

    it("records the high-water mark in state", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);

      clock.advance(250);
      api.now();

      expect(ctx.state.last).toBe(1250);
    });
  });

  describe("scheduleAt", () => {
    it("stores the pending due moment", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      api.scheduleAt(1500);

      expect(api.dueAt()).toBe(1500);
    });

    it("delivers elapsed once at the due moment", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      api.scheduleAt(1500);
      clock.advance(499);
      expect(listener).not.toHaveBeenCalled();

      clock.advance(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ now: 1500 });
    });

    it("clears the due moment before the listeners run", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const seen: Array<number | undefined> = [];
      api.onElapsed(() => seen.push(api.dueAt()));

      api.scheduleAt(1500);
      clock.advance(500);

      expect(seen).toEqual([undefined]);
      expect(api.dueAt()).toBeUndefined();
    });

    it("does not reschedule itself after the due moment", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      api.scheduleAt(1500);
      clock.advance(5000);
      clock.advance(5000);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("replaces the pending moment instead of adding a second one", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      api.scheduleAt(1500);
      api.scheduleAt(2000);
      clock.advance(500);
      expect(listener).not.toHaveBeenCalled();
      expect(api.dueAt()).toBe(2000);

      clock.advance(500);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ now: 2000 });
    });

    it("clears the replaced timer through the source", () => {
      const { ctx, clock } = createFakeCtx();
      const clearTimer = vi.spyOn(clock, "clearTimer");
      const api = createClockApi(ctx);

      api.scheduleAt(1500);
      const first = ctx.state.handle;
      api.scheduleAt(2000);

      expect(clearTimer).toHaveBeenCalledWith(first);
    });

    it("cancels the pending moment when called with undefined", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      api.scheduleAt(1500);
      api.scheduleAt(undefined);
      clock.advance(5000);

      expect(api.dueAt()).toBeUndefined();
      expect(ctx.state.handle).toBeUndefined();
      expect(listener).not.toHaveBeenCalled();
    });

    it("cancels nothing when there is no pending moment", () => {
      const { ctx, clock } = createFakeCtx();
      const clearTimer = vi.spyOn(clock, "clearTimer");
      const api = createClockApi(ctx);

      api.scheduleAt(undefined);

      expect(clearTimer).not.toHaveBeenCalled();
      expect(api.dueAt()).toBeUndefined();
    });

    it("fires a moment in the past on the next macrotask, not synchronously", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      api.scheduleAt(500);
      expect(listener).not.toHaveBeenCalled();
      expect(api.dueAt()).toBe(500);

      clock.advance(0);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ now: 1000 });
    });

    it("delivers to every listener", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const first = vi.fn();
      const second = vi.fn();
      api.onElapsed(first);
      api.onElapsed(second);

      api.scheduleAt(1500);
      clock.advance(500);

      expect(first).toHaveBeenCalledWith({ now: 1500 });
      expect(second).toHaveBeenCalledWith({ now: 1500 });
    });
  });

  describe("onElapsed", () => {
    it("registers a listener in state", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      api.onElapsed(() => {});

      expect(ctx.state.listeners).toHaveLength(1);
    });

    it("stops delivering after unsubscribe", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();

      const unsubscribe = api.onElapsed(listener);
      unsubscribe();
      api.poke();

      expect(listener).not.toHaveBeenCalled();
      expect(ctx.state.listeners).toHaveLength(0);
    });

    it("ignores a second unsubscribe", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);
      const kept = vi.fn();

      const unsubscribe = api.onElapsed(() => {});
      api.onElapsed(kept);
      unsubscribe();
      unsubscribe();
      api.poke();

      expect(ctx.state.listeners).toHaveLength(1);
      expect(kept).toHaveBeenCalledTimes(1);
    });

    it("keeps delivering to the listeners that stay", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);
      const dropped = vi.fn();
      const kept = vi.fn();

      const unsubscribe = api.onElapsed(dropped);
      api.onElapsed(kept);
      unsubscribe();
      api.poke();

      expect(dropped).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    it("delivers to the rest when a listener unsubscribes during delivery", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);
      const second = vi.fn();

      const unsubscribe = api.onElapsed(() => unsubscribe());
      api.onElapsed(second);
      api.poke();

      expect(second).toHaveBeenCalledTimes(1);
      expect(ctx.state.listeners).toHaveLength(1);
    });
  });

  describe("poke", () => {
    it("delivers elapsed with the current moment immediately", () => {
      const { ctx, clock } = createFakeCtx();
      const api = createClockApi(ctx);
      const listener = vi.fn();
      api.onElapsed(listener);

      clock.advance(3000);
      api.poke();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ now: 4000 });
    });

    it("keeps the pending due moment", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      api.scheduleAt(1500);
      api.poke();

      expect(api.dueAt()).toBe(1500);
    });

    it("does nothing when nobody listens", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      expect(() => api.poke()).not.toThrow();
    });
  });

  describe("dueAt", () => {
    it("is undefined before anything is scheduled", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      expect(api.dueAt()).toBeUndefined();
    });
  });

  describe("types", () => {
    it("delivers an Elapsed input to a listener", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      api.onElapsed(input => {
        expectTypeOf(input).toEqualTypeOf<Elapsed>();
        expectTypeOf(input.now).toBeNumber();
      });

      expect(ctx.state.listeners).toHaveLength(1);
    });

    it("returns an unsubscribe function from onElapsed", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      expectTypeOf(api.onElapsed).returns.toEqualTypeOf<() => void>();
      expectTypeOf(api.now).toEqualTypeOf<() => number>();
      expectTypeOf(api.dueAt).returns.toEqualTypeOf<number | undefined>();

      expect(ctx).toBeDefined();
    });

    it("rejects a moment that is not a number", () => {
      const { ctx } = createFakeCtx();
      const api = createClockApi(ctx);

      // @ts-expect-error -- scheduleAt takes a moment in milliseconds, not a date string
      api.scheduleAt("2026-09-21");

      expect(ctx).toBeDefined();
    });
  });

  describe("state shape", () => {
    it("works on a plain State object", () => {
      const clock = fakeClock(1000);
      const state: State = {
        source: clock,
        last: 0,
        dueAt: undefined,
        handle: undefined,
        listeners: []
      };
      const api = createClockApi({ global: {}, config: { source: clock }, state, emit: () => {} });

      api.scheduleAt(1100);

      expect(state.dueAt).toBe(1100);
      expect(state.handle).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Review finding of build wave 1: device clock moved back
// ---------------------------------------------------------------------------

describe("scheduleAt with a device clock that went back", () => {
  it("does not deliver the moment before trusted time reaches it", () => {
    const { ctx, clock } = createFakeCtx(10_000);
    const api = createClockApi(ctx);
    const seen: Elapsed[] = [];
    api.onElapsed(input => seen.push(input));
    api.now();

    clock.set(1000);
    api.scheduleAt(10_500);
    clock.advance(500);

    expect(seen).toEqual([]);
    expect(api.dueAt()).toBe(10_500);
  });

  it("delivers it once the device clock catches up", () => {
    const { ctx, clock } = createFakeCtx(10_000);
    const api = createClockApi(ctx);
    const seen: Elapsed[] = [];
    api.onElapsed(input => seen.push(input));
    api.now();

    clock.set(1000);
    api.scheduleAt(10_500);
    clock.advance(9500);

    expect(seen).toEqual([{ now: 10_500 }]);
    expect(api.dueAt()).toBeUndefined();
  });
});

const createStopState = (): { state: State; clock: FakeClock } => {
  const clock = fakeClock(1000);

  return {
    clock,
    state: { source: clock, last: 0, dueAt: undefined, handle: undefined, listeners: [] }
  };
};

describe("cancelPending, the onStop of the plugin", () => {
  it("clears the handle that exists at stop time", () => {
    const { state, clock } = createStopState();
    const clearTimer = vi.spyOn(clock, "clearTimer");
    const handle = clock.setTimer(() => {}, 1000);

    state.handle = handle;
    cancelPending(state);

    expect(clearTimer).toHaveBeenCalledWith(handle);
  });

  it("forgets the due moment and the handle, so dueAt() reports nothing after stop", () => {
    const { state, clock } = createStopState();

    state.handle = clock.setTimer(() => {}, 1000);
    state.dueAt = 2000;
    cancelPending(state);

    expect(state.handle).toBeUndefined();
    expect(state.dueAt).toBeUndefined();
  });

  it("stops the pending timer from firing", () => {
    const { state, clock } = createStopState();
    const fired = vi.fn();

    state.handle = clock.setTimer(fired, 1000);
    cancelPending(state);
    clock.advance(5000);

    expect(fired).not.toHaveBeenCalled();
  });

  it("is harmless when no timer was ever created", () => {
    const { state } = createStopState();

    expect(() => cancelPending(state)).not.toThrow();
  });
});
