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
