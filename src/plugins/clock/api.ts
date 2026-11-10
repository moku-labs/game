/**
 * @file clock plugin — API factory. Holds the monotonic rule, the single pending due moment and
 * the `elapsed` listeners.
 */
import { MAX_TIMER_MS } from "./system";
import type { Api, ClockCtx, Elapsed, State } from "./types";

/**
 * Reads the source plus the shift of `advance`, uncut. While the clock stands (F169) the source is
 * not read: the reading taken when it stopped stands in for it.
 *
 * @param state - Clock state.
 * @returns The raw moment, in epoch milliseconds.
 */
function rawNow(state: State): number {
  return (state.frozenAt ?? state.source.now()) + state.shift;
}

/**
 * Reads the source and raises the high-water mark. A source that goes back cannot move game time
 * back, and a fractional reading is cut to whole milliseconds. The shift of `advance` is added.
 *
 * @param state - Clock state.
 * @returns The highest moment ever returned, in epoch milliseconds.
 */
function readNow(state: State): number {
  const moment = Math.trunc(rawNow(state));

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
 * Arms the single timer for a due moment. The delay is counted from the RAW source reading plus
 * the shift of `advance`, not from trusted time: the source's timer runs on the device clock, so
 * after the device clock was moved back the wait is longer than `moment - now()`. A moment
 * further than the longest timer waits in steps: the timer fires early and `fireDue` arms it
 * again. A clock that stands keeps the moment and arms no timer: only `advance` reaches it, or the
 * timer armed when the clock goes on.
 *
 * @param state - Clock state.
 * @param moment - Due moment in epoch milliseconds.
 */
function arm(state: State, moment: number): void {
  state.dueAt = moment;

  if (state.frozenAt !== undefined) return;

  const raw = Math.trunc(rawNow(state));
  const delayMs = Math.min(MAX_TIMER_MS, Math.max(0, moment - raw));

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
 * Moves the clock forward by `ms`: the shift every reading adds grows, and the pending moment is
 * delivered at once when it is due now, or armed again for the rest of its wait.
 *
 * @param state - Clock state.
 * @param ms - Milliseconds forward.
 * @returns The trusted moment after the move.
 * @throws {RangeError} When `ms` is not a finite number above 0.
 */
function advanceBy(state: State, ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(
      `[game] clock.advance moves the clock forward, not by ${ms} ms.\n  Pass a finite number of milliseconds above 0.`
    );
  }

  state.shift += ms;

  const moment = state.dueAt;
  const now = readNow(state);

  if (moment === undefined) return now;

  cancelPending(state);

  if (now >= moment) deliverElapsed(state);
  else arm(state, moment);

  return now;
}

/**
 * Stops the clock (F169): `now()` stands at the moment it reads now, and the timer of the pending
 * moment is dropped, the moment kept. Only `advance` moves a standing clock. Stopping it twice
 * changes nothing.
 *
 * @param state - Clock state.
 */
export function freezeClock(state: State): void {
  if (state.frozenAt !== undefined) return;

  state.frozenAt = state.source.now();

  if (state.handle !== undefined) state.source.clearTimer(state.handle);

  state.handle = undefined;
}

/**
 * Lets a standing clock go on from where it stood: the span it stood is folded into the shift, so
 * it lags the source by that span and keeps every advance made meanwhile; it does not jump to the
 * source. The pending moment is armed again for the rest of its wait. A clock that runs is left
 * alone.
 *
 * @param state - Clock state.
 */
export function thawClock(state: State): void {
  if (state.frozenAt === undefined) return;

  state.shift += state.frozenAt - state.source.now();
  state.frozenAt = undefined;

  if (state.dueAt !== undefined) arm(state, state.dueAt);
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

    advance: (ms: number): number => advanceBy(ctx.state, ms),

    dueAt: (): number | undefined => ctx.state.dueAt,

    pending: (): number => (ctx.state.dueAt === undefined ? 0 : 1),

    listeners: (): number => ctx.state.listeners.length
  };
}
