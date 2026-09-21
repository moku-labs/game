/**
 * @file clock plugin — fake time source for tests. Needs no real timer: `advance` fires the due
 * timers itself, so a test never waits and never depends on the device clock.
 */
import type { FakeClock } from "./types";

/**
 * One pending timer of a fake clock.
 *
 * @example
 * ```ts
 * const timer: FakeTimer = { id: 1, at: 1500, callback: fire };
 * ```
 */
type FakeTimer = { readonly id: number; readonly at: number; readonly callback: () => void };

/**
 * Mutable innards of one fake clock: the current moment, the next handle and the pending timers.
 *
 * @example
 * ```ts
 * const state: FakeState = { now: 1000, nextId: 1, timers: [] };
 * ```
 */
type FakeState = { now: number; nextId: number; timers: FakeTimer[] };

/**
 * Removes and returns the timer that is due first, up to and including `until`.
 * Timers due at the same moment come out in the order they were scheduled.
 *
 * @param state - Innards of the fake clock.
 * @param until - Latest moment that counts as due.
 * @returns The timer to fire, or `undefined` when nothing is due.
 * @example
 * ```ts
 * const due = takeDue(state, 1500);
 * ```
 */
function takeDue(state: FakeState, until: number): FakeTimer | undefined {
  let earliest: FakeTimer | undefined;

  for (const timer of state.timers) {
    if (timer.at > until) continue;
    if (earliest === undefined || timer.at < earliest.at) earliest = timer;
  }

  if (earliest === undefined) return undefined;

  const due = earliest;
  state.timers = state.timers.filter(timer => timer !== due);
  return due;
}

/**
 * Moves the clock to `until`, firing every timer that falls due on the way, in due order.
 * A timer scheduled inside a callback fires in the same run when it is due before `until`.
 *
 * @param state - Innards of the fake clock.
 * @param until - Moment to stop at.
 * @example
 * ```ts
 * runDue(state, state.now + 5000);
 * ```
 */
function runDue(state: FakeState, until: number): void {
  let due = takeDue(state, until);

  while (due !== undefined) {
    state.now = Math.max(state.now, due.at);
    due.callback();
    due = takeDue(state, until);
  }

  state.now = Math.max(state.now, until);
}

/**
 * Creates a fake source for tests. Timers fire synchronously inside `advance`, in due order.
 *
 * @param start - Starting moment in epoch milliseconds. Defaults to 0.
 * @returns A clock source with the test-only controls `advance` and `set`.
 * @example
 * ```ts
 * const clock = fakeClock(1000);
 * clock.advance(5000);
 * ```
 */
export function fakeClock(start = 0): FakeClock {
  const state: FakeState = { now: start, nextId: 1, timers: [] };

  return {
    /**
     * Reads the fake moment.
     *
     * @returns The current moment in epoch milliseconds.
     * @example
     * ```ts
     * const moment = clock.now();
     * ```
     */
    now: (): number => state.now,

    /**
     * Schedules one callback. A negative delay counts as zero.
     *
     * @param callback - Function to run when the delay has passed.
     * @param delayMs - Delay in milliseconds.
     * @returns The handle to give back to `clearTimer`.
     * @example
     * ```ts
     * const handle = clock.setTimer(fire, 1000);
     * ```
     */
    setTimer: (callback: () => void, delayMs: number): number => {
      const id = state.nextId;

      state.nextId += 1;
      state.timers.push({ id, at: state.now + Math.max(0, delayMs), callback });
      return id;
    },

    /**
     * Cancels a pending timer. An unknown handle is ignored.
     *
     * @param handle - Handle returned by `setTimer`.
     * @example
     * ```ts
     * clock.clearTimer(handle);
     * ```
     */
    clearTimer: (handle: unknown): void => {
      if (typeof handle !== "number") return;

      state.timers = state.timers.filter(timer => timer.id !== handle);
    },

    /**
     * Moves the clock forward and fires every timer that falls due, in due order.
     * A negative amount moves nothing.
     *
     * @param ms - Milliseconds to move forward.
     * @example
     * ```ts
     * clock.advance(60_000);
     * ```
     */
    advance: (ms: number): void => {
      runDue(state, state.now + Math.max(0, ms));
    },

    /**
     * Jumps the clock to a moment without firing any timer. Moving back is allowed: that is a
     * device clock set by hand.
     *
     * @param moment - Moment in epoch milliseconds.
     * @example
     * ```ts
     * clock.set(400);
     * ```
     */
    set: (moment: number): void => {
      state.now = moment;
    }
  };
}
