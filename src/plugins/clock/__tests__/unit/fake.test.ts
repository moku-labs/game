import { describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../fake";
import type { ClockSource, FakeClock } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: fakeClock — the deterministic source used by every other test
// ---------------------------------------------------------------------------

describe("fakeClock", () => {
  describe("now", () => {
    it("starts at zero by default", () => {
      expect(fakeClock().now()).toBe(0);
    });

    it("starts at the given moment", () => {
      expect(fakeClock(1000).now()).toBe(1000);
    });

    it("moves forward by the advanced amount", () => {
      const clock = fakeClock(1000);

      clock.advance(250);

      expect(clock.now()).toBe(1250);
    });

    it("ignores a negative advance", () => {
      const clock = fakeClock(1000);

      clock.advance(-500);

      expect(clock.now()).toBe(1000);
    });
  });

  describe("set", () => {
    it("jumps the clock forward without firing timers", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      clock.setTimer(fired, 100);
      clock.set(5000);

      expect(clock.now()).toBe(5000);
      expect(fired).not.toHaveBeenCalled();
    });

    it("moves the clock back, like a device clock set by hand", () => {
      const clock = fakeClock(1000);

      clock.set(400);

      expect(clock.now()).toBe(400);
    });
  });

  describe("setTimer", () => {
    it("fires a timer when its moment is reached", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      clock.setTimer(fired, 500);
      clock.advance(499);
      expect(fired).not.toHaveBeenCalled();

      clock.advance(1);
      expect(fired).toHaveBeenCalledTimes(1);
    });

    it("fires a zero delay timer on the next advance(0)", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      clock.setTimer(fired, 0);
      expect(fired).not.toHaveBeenCalled();

      clock.advance(0);
      expect(fired).toHaveBeenCalledTimes(1);
    });

    it("treats a negative delay as zero", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      clock.setTimer(fired, -5000);
      clock.advance(0);

      expect(fired).toHaveBeenCalledTimes(1);
    });

    it("fires several timers in due order, not in schedule order", () => {
      const clock = fakeClock(1000);
      const order: string[] = [];

      clock.setTimer(() => order.push("late"), 300);
      clock.setTimer(() => order.push("early"), 100);
      clock.setTimer(() => order.push("middle"), 200);
      clock.advance(1000);

      expect(order).toEqual(["early", "middle", "late"]);
    });

    it("fires timers due at the same moment in schedule order", () => {
      const clock = fakeClock(1000);
      const order: string[] = [];

      clock.setTimer(() => order.push("first"), 100);
      clock.setTimer(() => order.push("second"), 100);
      clock.advance(100);

      expect(order).toEqual(["first", "second"]);
    });

    it("reports the due moment as now() inside the callback", () => {
      const clock = fakeClock(1000);
      const seen: number[] = [];

      clock.setTimer(() => seen.push(clock.now()), 100);
      clock.setTimer(() => seen.push(clock.now()), 400);
      clock.advance(1000);

      expect(seen).toEqual([1100, 1400]);
      expect(clock.now()).toBe(2000);
    });

    it("fires a timer scheduled inside a callback when it is due in the same window", () => {
      const clock = fakeClock(1000);
      const order: string[] = [];

      clock.setTimer(() => {
        order.push("outer");
        clock.setTimer(() => order.push("inner"), 100);
      }, 100);
      clock.advance(500);

      expect(order).toEqual(["outer", "inner"]);
    });

    it("keeps a timer scheduled inside a callback pending when it is due later", () => {
      const clock = fakeClock(1000);
      const order: string[] = [];

      clock.setTimer(() => {
        order.push("outer");
        clock.setTimer(() => order.push("inner"), 1000);
      }, 100);
      clock.advance(100);

      expect(order).toEqual(["outer"]);
    });

    it("fires each timer once", () => {
      const clock = fakeClock();
      const fired = vi.fn();

      clock.setTimer(fired, 10);
      clock.advance(100);
      clock.advance(100);

      expect(fired).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearTimer", () => {
    it("cancels a pending timer", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      const handle = clock.setTimer(fired, 100);
      clock.clearTimer(handle);
      clock.advance(1000);

      expect(fired).not.toHaveBeenCalled();
    });

    it("leaves the other timers pending", () => {
      const clock = fakeClock(1000);
      const cancelled = vi.fn();
      const kept = vi.fn();

      const handle = clock.setTimer(cancelled, 100);
      clock.setTimer(kept, 100);
      clock.clearTimer(handle);
      clock.advance(1000);

      expect(cancelled).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an unknown handle", () => {
      const clock = fakeClock(1000);
      const fired = vi.fn();

      clock.setTimer(fired, 100);
      clock.clearTimer(undefined);
      clock.clearTimer("not a handle");
      clock.advance(1000);

      expect(fired).toHaveBeenCalledTimes(1);
    });
  });

  describe("types", () => {
    it("is a ClockSource with the test-only controls", () => {
      const clock: FakeClock = fakeClock(1000);
      const source: ClockSource = clock;

      expect(source.now()).toBe(1000);
    });
  });
});
