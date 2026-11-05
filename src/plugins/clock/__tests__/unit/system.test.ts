import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemSource } from "../../system";

// ---------------------------------------------------------------------------
// Unit test: systemSource — the one file allowed to read the device clock (L3)
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("systemSource", () => {
  describe("now", () => {
    it("reads epoch milliseconds from the device clock", () => {
      expect(systemSource().now()).toBe(1_700_000_000_000);
    });

    it("returns an integer", () => {
      const moment = systemSource().now();

      expect(Number.isInteger(moment)).toBe(true);
    });
  });

  describe("setTimer", () => {
    it("fires the callback after the delay", () => {
      const source = systemSource();
      const fired = vi.fn();

      source.setTimer(fired, 500);
      vi.advanceTimersByTime(499);
      expect(fired).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fired).toHaveBeenCalledTimes(1);
    });

    // Bug caught (F151): a delay over 2^31−1 ms overflows `setTimeout`, which fires at once. The
    // test reads the delays handed to the platform: fake timers alone never overflow.
    it("waits a delay of 88 days in steps the platform timer keeps, and fires once", () => {
      const day = 86_400_000;
      const platform = vi.spyOn(globalThis, "setTimeout");
      const fired = vi.fn();

      systemSource().setTimer(fired, 88 * day);
      vi.advanceTimersByTime(2_147_483_647 * 3);
      expect(fired).not.toHaveBeenCalled();

      vi.advanceTimersByTime(88 * day - 2_147_483_647 * 3);
      expect(fired).toHaveBeenCalledOnce();
      expect(platform.mock.calls.map(([, delay]) => delay)).toEqual([
        2_147_483_647,
        2_147_483_647,
        2_147_483_647,
        88 * day - 2_147_483_647 * 3
      ]);
    });

    // Bug caught: a delay of exactly the longest timer takes a second, empty step, or a delay
    // one past it overflows in one step.
    it.each([
      [2_147_483_647, [2_147_483_647]],
      [2_147_483_648, [2_147_483_647, 1]]
    ])("waits %d ms in the steps %j", (delay, steps) => {
      const platform = vi.spyOn(globalThis, "setTimeout");

      systemSource().setTimer(() => {}, delay);
      vi.advanceTimersByTime(delay);

      expect(platform.mock.calls.map(([, wait]) => wait)).toEqual(steps);
    });

    // Bug caught: a long wait cancelled after its first step fires anyway, because the handle
    // still holds the first, finished timer.
    it("cancels a long wait in its later steps", () => {
      const source = systemSource();
      const fired = vi.fn();

      const handle = source.setTimer(fired, 2_147_483_647 + 1000);
      vi.advanceTimersByTime(2_147_483_647);
      source.clearTimer(handle);
      vi.advanceTimersByTime(1000);

      expect(fired).not.toHaveBeenCalled();
    });

    it("returns a handle that is not the raw platform timer", () => {
      const source = systemSource();

      const handle = source.setTimer(() => {}, 100);

      expect(handle).toBeDefined();
      vi.advanceTimersByTime(100);
    });
  });

  describe("clearTimer", () => {
    it("cancels a pending timer", () => {
      const source = systemSource();
      const fired = vi.fn();

      const handle = source.setTimer(fired, 100);
      source.clearTimer(handle);
      vi.advanceTimersByTime(1000);

      expect(fired).not.toHaveBeenCalled();
    });

    it("does nothing for an undefined handle", () => {
      const source = systemSource();
      const fired = vi.fn();

      source.setTimer(fired, 100);
      expect(() => source.clearTimer(undefined)).not.toThrow();

      vi.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a foreign handle", () => {
      const source = systemSource();

      expect(() => source.clearTimer({ notATimer: true })).not.toThrow();
    });
  });
});
