import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { coreConfig, createCore } from "../../../../config";
import { fakeClock } from "../../fake";
import { clockPlugin } from "../../index";
import type { Elapsed, FakeClock } from "../../types";

// ---------------------------------------------------------------------------
// Integration test: clock on a bare framework (the engine defaults are not built yet)
// ---------------------------------------------------------------------------

const bare = createCore(coreConfig, { plugins: [] });

const createTestApp = (clock: FakeClock = fakeClock(1000)) => {
  const app = bare.createApp({
    plugins: [clockPlugin],
    pluginConfigs: { clock: { source: clock } }
  });

  return { app, clock };
};

describe("clock plugin integration", () => {
  it("exposes the API on the app", async () => {
    const { app } = createTestApp();
    await app.start();

    expect(app.clock.now()).toBe(1000);
    expect(app.clock.dueAt()).toBeUndefined();

    await app.stop();
  });

  it("schedules a moment and delivers elapsed once when it arrives", async () => {
    const { app, clock } = createTestApp();
    const received: Elapsed[] = [];
    await app.start();

    app.clock.onElapsed(input => received.push(input));
    app.clock.scheduleAt(app.clock.now() + 60_000);
    clock.advance(59_999);
    expect(received).toEqual([]);

    clock.advance(1);
    expect(received).toEqual([{ now: 61_000 }]);
    expect(app.clock.dueAt()).toBeUndefined();

    await app.stop();
  });

  it("delivers elapsed on poke, as a resume from background does", async () => {
    const { app, clock } = createTestApp();
    const received: Elapsed[] = [];
    await app.start();

    app.clock.onElapsed(input => received.push(input));
    clock.advance(30_000);
    app.clock.poke();

    expect(received).toEqual([{ now: 31_000 }]);

    await app.stop();
  });

  it("keeps now() monotonic across a device clock moved back", async () => {
    const { app, clock } = createTestApp();
    await app.start();

    expect(app.clock.now()).toBe(1000);
    clock.set(200);

    expect(app.clock.now()).toBe(1000);

    await app.stop();
  });

  it("clears the pending timer on stop", async () => {
    const { app, clock } = createTestApp();
    const clearTimer = vi.spyOn(clock, "clearTimer");
    const listener = vi.fn();
    await app.start();

    app.clock.onElapsed(listener);
    app.clock.scheduleAt(5000);
    await app.stop();
    clock.advance(10_000);

    expect(clearTimer).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops cleanly when no timer was ever scheduled", async () => {
    const { app } = createTestApp();
    await app.start();

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("keeps two apps and their sources apart", async () => {
    const first = createTestApp(fakeClock(1000));
    const second = createTestApp(fakeClock(5000));
    await first.app.start();
    await second.app.start();

    first.clock.advance(1000);

    expect(first.app.clock.now()).toBe(2000);
    expect(second.app.clock.now()).toBe(5000);

    await first.app.stop();
    await second.app.stop();
  });

  it("uses the system source when no source is configured", () => {
    const app = bare.createApp({ plugins: [clockPlugin] });

    expect(Number.isInteger(app.clock.now())).toBe(true);
  });

  describe("types", () => {
    it("accepts a fake clock as the configured source", () => {
      const { app } = createTestApp();

      expectTypeOf(app.clock.now).toEqualTypeOf<() => number>();
      expectTypeOf(app.clock.scheduleAt).parameter(0).toEqualTypeOf<number | undefined>();
      expectTypeOf(app.clock.dueAt).returns.toEqualTypeOf<number | undefined>();

      expect(app.clock).toBeDefined();
    });

    it("rejects a source that is not a ClockSource", () => {
      const app = bare.createApp({
        plugins: [clockPlugin],
        // @ts-expect-error -- source must implement now/setTimer/clearTimer
        pluginConfigs: { clock: { source: { now: () => 0 } } }
      });

      expect(app.clock.now()).toBe(0);
    });
  });
});
