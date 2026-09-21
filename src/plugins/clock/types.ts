/**
 * @file clock plugin — type definitions.
 */
import type { PluginCtx } from "@moku-labs/core";

/**
 * Source of time and timers. The system source is the default; a game passes its own when time
 * must come from somewhere else, for example a server.
 *
 * @example
 * ```ts
 * // Server time: the device clock only measures the distance from the last sync. The plugin keeps
 * // at most one timer alive, so the source remembers one.
 * const serverClock = (serverNow: number): ClockSource => {
 *   const syncedAt = performance.now();
 *   let timer: ReturnType<typeof setTimeout> | undefined;
 *
 *   return {
 *     now: () => serverNow + (performance.now() - syncedAt),
 *     setTimer: (callback, delayMs) => (timer = setTimeout(callback, delayMs)),
 *     clearTimer: () => clearTimeout(timer)
 *   };
 * };
 *
 * createApp({ pluginConfigs: { clock: { source: serverClock(1_790_000_000_000) } } });
 * ```
 */
export type ClockSource = {
  /**
   * Reads the current moment.
   *
   * @returns Epoch milliseconds. A fraction is cut by the plugin; going back is tolerated.
   */
  now(): number;

  /**
   * Schedules one callback. The plugin keeps at most one timer alive.
   *
   * @param callback - Function to run when the delay has passed.
   * @param delayMs - Delay in milliseconds, never negative.
   * @returns A handle of any shape; the plugin only hands it back to `clearTimer`.
   */
  setTimer(callback: () => void, delayMs: number): unknown;

  /**
   * Cancels a pending timer. A handle this source did not produce must be ignored.
   *
   * @param handle - Handle returned by `setTimer`.
   */
  clearTimer(handle: unknown): void;
};

/**
 * Fake source for tests, from `@moku-labs/game/testing`. It needs no real timer.
 *
 * @example
 * ```ts
 * // An energy point refills after 60 s. The test does not wait: it moves the clock.
 * const clock = fakeClock(1000);
 * const app = createApp({ pluginConfigs: { clock: { source: clock } } });
 *
 * app.clock.scheduleAt(61_000);
 * clock.advance(60_000); // the listeners of onElapsed get { now: 61000 }
 * ```
 */
export type FakeClock = ClockSource & {
  /**
   * Moves the clock forward and fires every timer that falls due on the way, in due order.
   *
   * @param ms - Milliseconds to move forward. A negative amount moves nothing.
   * @example
   * ```ts
   * clock.advance(5000); // now() is 5000 later, a timer due in 3000 has fired
   * ```
   */
  advance(ms: number): void;

  /**
   * Jumps to a moment without firing any timer. Moving back is allowed: that is a player who
   * sets the device clock by hand.
   *
   * @param moment - Moment in epoch milliseconds.
   * @example
   * ```ts
   * clock.set(400); // the device clock went back; app.clock.now() does not decrease
   * ```
   */
  set(moment: number): void;
};

/**
 * Input delivered to `onElapsed` listeners when a due moment arrives or the game resumes.
 *
 * @example
 * ```ts
 * const input: Elapsed = { now: 1_790_000_060_000 };
 * ```
 */
export type Elapsed = { now: number };

/**
 * clock plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { clock: { source: fakeClock(1000) } } });
 * ```
 */
export type Config = {
  /**
   * Time source. `undefined` means the system source: `Date.now` and `setTimeout`.
   */
  source: ClockSource | undefined;
};

/**
 * clock plugin state.
 */
export type State = {
  source: ClockSource;
  last: number;
  dueAt: number | undefined;
  handle: unknown;
  listeners: Array<(input: Elapsed) => void>;
};

/**
 * clock plugin API, `app.clock`. Trusted time for rules that depend on real time: energy refill,
 * generators, daily rewards. The clock holds ONE pending moment; the rules decide the next one.
 *
 * @example
 * ```ts
 * // The whole cycle: ask the rules for the nearest moment, wait for it, apply, ask again.
 * app.clock.onElapsed(({ now }) => {
 *   applyRefills(now);
 *   app.clock.scheduleAt(nextRefillAt(now)); // undefined when nothing is pending
 * });
 * app.clock.scheduleAt(nextRefillAt(app.clock.now()));
 * ```
 */
export type Api = {
  /**
   * Reads trusted time. It never decreases, whatever the device clock does, so a player who sets
   * the clock back gains nothing.
   *
   * @returns The current moment in epoch milliseconds, an integer.
   * @example
   * ```ts
   * // Stamp a generator when it is used, and compare later.
   * player.generator.usedAt = app.clock.now(); // 1790000000000
   * const ready = app.clock.now() - player.generator.usedAt >= 60_000;
   * ```
   */
  now(): number;

  /**
   * Replaces the single pending due moment. A moment in the past is not delivered synchronously:
   * it fires on the next macrotask of the source.
   *
   * @param moment - Moment in epoch milliseconds, or `undefined` to cancel.
   * @example
   * ```ts
   * // A generator refills in 60 s. Only one moment is pending: the nearest one.
   * app.clock.scheduleAt(app.clock.now() + 60_000);
   * app.clock.scheduleAt(undefined); // nothing is due any more: cancel
   * ```
   */
  scheduleAt(moment: number | undefined): void;

  /**
   * Registers a listener for the `elapsed` input: a due moment arrived, or `poke` was called.
   * The clock does not reschedule by itself.
   *
   * @param listener - Called with `{ now }`, the trusted moment of the delivery.
   * @returns The unsubscribe function.
   * @example
   * ```ts
   * const off = app.clock.onElapsed(({ now }) => {
   *   applyRefills(now); // now: 1790000060000
   * });
   *
   * off(); // the screen that showed the timer is closed
   * ```
   */
  onElapsed(listener: (input: Elapsed) => void): () => void;

  /**
   * Delivers `elapsed` right now, without touching the pending due moment. The engine calls it
   * when the game resumes; a game calls it after it changed something the rules depend on.
   *
   * @example
   * ```ts
   * // The game synced with its server and the time source jumped forward: let the rules catch up.
   * // On resume from background the engine pokes by itself, a game never does that.
   * app.clock.poke(); // onElapsed listeners get { now } at once; the pending moment stays
   * ```
   */
  poke(): void;

  /**
   * Reads the pending due moment, for inspection and tests.
   *
   * @returns The pending moment, or `undefined` when nothing is scheduled.
   * @example
   * ```ts
   * app.clock.scheduleAt(1500);
   * app.clock.dueAt(); // 1500
   * await app.stop();
   * app.clock.dueAt(); // undefined
   * ```
   */
  dueAt(): number | undefined;
};

/**
 * Domain context of the clock plugin.
 */
export type ClockCtx = PluginCtx<Config, State> & { readonly global: object };
