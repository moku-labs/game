/**
 * @file clock plugin — API factory. Holds the monotonic rule, the single pending due moment and
 * the `elapsed` listeners.
 */
import type { Api, ClockCtx, Elapsed, State } from "./types";

/**
 * Reads the source and raises the high-water mark. A source that goes back cannot move game time
 * back, and a fractional reading is cut to whole milliseconds.
 *
 * @param state - Clock state.
 * @returns The highest moment ever returned, in epoch milliseconds.
 * @example
 * ```ts
 * const moment = readNow(ctx.state);
 * ```
 */
function readNow(state: State): number {
  const moment = Math.trunc(state.source.now());

  if (moment > state.last) state.last = moment;
  return state.last;
}

/**
 * Drops the pending due moment and its timer, if there is one.
 *
 * @param state - Clock state.
 * @example
 * ```ts
 * cancelPending(ctx.state);
 * ```
 */
export function cancelPending(state: State): void {
  if (state.handle !== undefined) state.source.clearTimer(state.handle);

  state.handle = undefined;
  state.dueAt = undefined;
}

/**
 * Delivers one `elapsed` input to the listeners registered at this instant. The list is copied
 * first, so a listener that unsubscribes during delivery does not hide its neighbour.
 *
 * @param state - Clock state.
 * @example
 * ```ts
 * deliverElapsed(ctx.state);
 * ```
 */
function deliverElapsed(state: State): void {
  const moment = readNow(state);
  const listeners = [...state.listeners];

  for (const listener of listeners) listener({ now: moment });
}

/**
 * Arms the single timer for a due moment. The delay is counted from the RAW source reading, not
 * from trusted time: the source's timer runs on the device clock, so after the device clock was
 * moved back the wait is longer than `moment - now()`.
 *
 * @param state - Clock state.
 * @param moment - Due moment in epoch milliseconds.
 * @example
 * ```ts
 * arm(ctx.state, rules.nextDue(player, tables));
 * ```
 */
function arm(state: State, moment: number): void {
  const delayMs = Math.max(0, moment - Math.trunc(state.source.now()));

  state.dueAt = moment;
  state.handle = state.source.setTimer(() => fireDue(state), delayMs);
}

/**
 * Runs when the timer fires. A timer that fired before trusted time reached the moment is armed
 * again. Otherwise the due moment is forgotten first, then the listeners hear about it. The clock
 * never reschedules a delivered moment by itself — the rules decide the next one.
 *
 * @param state - Clock state.
 * @example
 * ```ts
 * state.source.setTimer(() => fireDue(state), delayMs);
 * ```
 */
function fireDue(state: State): void {
  const moment = state.dueAt;
  state.handle = undefined;

  if (moment !== undefined && readNow(state) < moment) {
    arm(state, moment);
    return;
  }

  state.dueAt = undefined;
  deliverElapsed(state);
}

/**
 * Removes one listener. A second removal of the same listener does nothing.
 *
 * @param state - Clock state.
 * @param listener - The listener registered by `onElapsed`.
 * @example
 * ```ts
 * removeListener(ctx.state, listener);
 * ```
 */
function removeListener(state: State, listener: (input: Elapsed) => void): void {
  const index = state.listeners.indexOf(listener);

  if (index === -1) return;

  state.listeners.splice(index, 1);
}

/**
 * Creates the clock API: a monotonic `now()`, the single pending due moment, the `elapsed`
 * listeners and `poke` for resume from background.
 *
 * @param ctx - Domain context of the clock plugin.
 * @returns The clock API exposed as `app.clock`.
 * @example
 * ```ts
 * const api = createClockApi(ctx);
 * api.scheduleAt(api.now() + 60_000);
 * ```
 */
export function createClockApi(ctx: ClockCtx): Api {
  return {
    /**
     * Reads trusted time. Never decreases, whatever the device clock does.
     *
     * @returns The current moment in epoch milliseconds, an integer.
     * @example
     * ```ts
     * const moment = app.clock.now();
     * ```
     */
    now: (): number => readNow(ctx.state),

    /**
     * Replaces the single pending due moment. `undefined` cancels it. A moment in the past is not
     * delivered synchronously: it fires on the next macrotask of the source.
     *
     * @param moment - Moment in epoch milliseconds, or `undefined` to cancel.
     * @example
     * ```ts
     * app.clock.scheduleAt(rules.nextDue(player, tables));
     * ```
     */
    scheduleAt: (moment: number | undefined): void => {
      cancelPending(ctx.state);

      if (moment === undefined) return;

      arm(ctx.state, moment);
    },

    /**
     * Registers a listener for the `elapsed` input.
     *
     * @param listener - Called with `{ now }` when a due moment arrives or on `poke`.
     * @returns The unsubscribe function.
     * @example
     * ```ts
     * const off = app.clock.onElapsed(input => inbox.push({ type: "elapsed", ...input }));
     * ```
     */
    onElapsed: (listener: (input: Elapsed) => void): (() => void) => {
      ctx.state.listeners.push(listener);

      return () => removeListener(ctx.state, listener);
    },

    /**
     * Delivers `elapsed` right now, without touching the pending due moment. Used on resume from
     * background, where the timer of a sleeping tab never fired.
     *
     * @example
     * ```ts
     * app.clock.poke();
     * ```
     */
    poke: (): void => {
      deliverElapsed(ctx.state);
    },

    /**
     * Reads the pending due moment, for inspection and tests.
     *
     * @returns The pending moment, or `undefined` when nothing is scheduled.
     * @example
     * ```ts
     * expect(app.clock.dueAt()).toBe(1500);
     * ```
     */
    dueAt: (): number | undefined => ctx.state.dueAt
  };
}
