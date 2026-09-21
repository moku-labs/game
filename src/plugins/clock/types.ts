/**
 * @file clock plugin — type definitions.
 */
import type { PluginCtx } from "@moku-labs/core";

/**
 * Source of time and timers. The system source is the only code that reads the device clock.
 *
 * @example
 * ```ts
 * const source: ClockSource = fakeClock(1000);
 * ```
 */
export type ClockSource = {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
};

/**
 * Fake source for tests.
 *
 * @example
 * ```ts
 * const clock: FakeClock = fakeClock();
 * clock.advance(5000);
 * ```
 */
export type FakeClock = ClockSource & { advance(ms: number): void; set(moment: number): void };

/**
 * Input delivered when a due moment arrives or the game resumes.
 *
 * @example
 * ```ts
 * const input: Elapsed = { now: clock.now() };
 * ```
 */
export type Elapsed = { now: number };

/**
 * clock plugin config.
 *
 * @example
 * ```ts
 * const config: Config = { source: undefined };
 * ```
 */
export type Config = {
  /**
   * Time source. `undefined` means the system source.
   */
  source: ClockSource | undefined;
};

/**
 * clock plugin state.
 *
 * @example
 * ```ts
 * const state: State = createClockState({ global, config });
 * ```
 */
export type State = {
  source: ClockSource;
  last: number;
  dueAt: number | undefined;
  handle: unknown;
  listeners: Array<(input: Elapsed) => void>;
};

/**
 * clock plugin API.
 *
 * @example
 * ```ts
 * const clock: Api = ctx.require(clockPlugin);
 * clock.scheduleAt(clock.now() + 60_000);
 * ```
 */
export type Api = {
  now(): number;
  scheduleAt(moment: number | undefined): void;
  onElapsed(listener: (input: Elapsed) => void): () => void;
  poke(): void;
  dueAt(): number | undefined;
};

/**
 * Domain context of the clock plugin.
 *
 * @example
 * ```ts
 * const api = createClockApi(ctx satisfies ClockCtx);
 * ```
 */
export type ClockCtx = PluginCtx<Config, State> & { readonly global: object };
