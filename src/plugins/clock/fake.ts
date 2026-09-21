/**
 * @file clock plugin — fake time source for tests. Needs no real timer: `advance` fires the due
 * timers itself, so a test never waits and never depends on the device clock.
 */
import type { FakeClock } from "./types";

/**
 * One pending timer of a fake clock.
 *
 */
type FakeTimer = { readonly id: number; readonly at: number; readonly callback: () => void };

/**
 * Mutable innards of one fake clock: the current moment, the next handle and the pending timers.
 *
 */
type FakeState = { now: number; nextId: number; timers: FakeTimer[] };

/**
 * Removes and returns the timer that is due first, up to and including `until`.
 * Timers due at the same moment come out in the order they were scheduled.
 *
 * @param state - Innards of the fake clock.
 * @param until - Latest moment that counts as due.
 * @returns The timer to fire, or `undefined` when nothing is due.
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
 * Creates a fake source for tests. Timers fire synchronously inside `advance`, in due order. A
 * negative delay counts as zero and an unknown handle is ignored.
 *
 * @param start - Starting moment in epoch milliseconds. Defaults to 0.
 * @returns A clock source with the test-only controls `advance` and `set`.
 * @example
 * ```ts
 * // An energy point refills 60 s after it was spent. The test moves the clock, not the minute.
 * const clock = fakeClock(1000);
 * const app = createApp({ pluginConfigs: { clock: { source: clock } } });
 * const seen: number[] = [];
 *
 * app.clock.onElapsed(({ now }) => seen.push(now));
 * app.clock.scheduleAt(61_000);
 * clock.advance(60_000); // the timer fires inside advance, nothing waits
 * seen; // [61000]
 * ```
 */
export function fakeClock(start = 0): FakeClock {
  const state: FakeState = { now: start, nextId: 1, timers: [] };

  return {
    now: (): number => state.now,

    setTimer: (callback: () => void, delayMs: number): number => {
      const id = state.nextId;

      state.nextId += 1;
      state.timers.push({ id, at: state.now + Math.max(0, delayMs), callback });
      return id;
    },

    clearTimer: (handle: unknown): void => {
      if (typeof handle !== "number") return;

      state.timers = state.timers.filter(timer => timer.id !== handle);
    },

    advance: (ms: number): void => {
      runDue(state, state.now + Math.max(0, ms));
    },

    set: (moment: number): void => {
      state.now = moment;
    }
  };
}
