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
 */
export function createClockApi(ctx: ClockCtx): Api {
  return {
    now: (): number => readNow(ctx.state),

    scheduleAt: (moment: number | undefined): void => {
      cancelPending(ctx.state);

      if (moment === undefined) return;

      arm(ctx.state, moment);
    },

    onElapsed: (listener: (input: Elapsed) => void): (() => void) => {
      ctx.state.listeners.push(listener);

      return () => removeListener(ctx.state, listener);
    },

    poke: (): void => {
      deliverElapsed(ctx.state);
    },

    dueAt: (): number | undefined => ctx.state.dueAt
  };
}
