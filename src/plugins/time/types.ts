/**
 * @file time plugin — type definitions.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";

/**
 * Frame phases, in call order.
 *
 * @example
 * ```ts
 * const phase: Phase = "animate";
 * ```
 */
export type Phase = "input" | "animate" | "layout" | "sync" | "signals" | "render";

/**
 * The Time resource, in scaled milliseconds.
 *
 * @example
 * ```ts
 * const time: Time = { delta: 16, elapsed: 1600, scale: 1, frame: 100 };
 * ```
 */
export type Time = { delta: number; elapsed: number; scale: number; frame: number };

/**
 * Callback run once per frame in its phase.
 *
 * @example
 * ```ts
 * const advanceTweens: FrameCallback = time => tweens.advance(time.delta);
 * ```
 */
export type FrameCallback = (time: Readonly<Time>) => void;

/**
 * time plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { time: { maxFps: 30 } } });
 * ```
 */
export type Config = {
  /**
   * Frame rate cap. The default is 60. 120 is for WebViews that really deliver 120 Hz frames:
   * Android today; WKWebView on iOS and macOS is capped at 60 by WebKit (bug 294338).
   */
  maxFps: 30 | 60 | 120;
  /**
   * Upper bound of one frame's delta in milliseconds.
   */
  maxDeltaMs: number;
};

/**
 * time plugin state.
 */
export type State = {
  callbacks: Record<Phase, FrameCallback[]>;
  /**
   * Scratch array of a frame: the six callback lists as they were when the frame started.
   */
  captured: (readonly FrameCallback[])[];
  time: Time;
  paused: boolean;
  running: boolean;
  /**
   * True while a frame runs; guards `step` re-entry.
   */
  stepping: boolean;
  rafId: number | undefined;
  lastTimestamp: number | undefined;
};

/**
 * time plugin API, `app.time`. The one clock of the screen: frame callbacks per phase, the `Time`
 * resource, the time scale, and `step` for tests and tools.
 *
 * @example
 * ```ts
 * // Frame work is a callback in a phase. A test has no frame source: it drives the frames itself.
 * const off = app.time.onFrame("animate", time => counter.advance(time.delta));
 *
 * app.time.step(16); // the callback gets { delta: 16, elapsed: 16, scale: 1, frame: 1 }
 * off();
 * ```
 */
export type Api = {
  /**
   * Registers a frame callback. Callbacks of one phase run in registration order; a callback
   * registered during a frame runs from the next frame on.
   *
   * @param phase - Phase the callback belongs to.
   * @param callback - Function called once per frame with the current `Time`.
   * @returns Unsubscribe function; calling it twice is a no-op.
   * @example
   * ```ts
   * // The coin counter rolls up while the reward popup is open.
   * const off = app.time.onFrame("animate", time => counter.advance(time.delta));
   *
   * off(); // the popup is closed
   * ```
   */
  onFrame(phase: Phase, callback: FrameCallback): () => void;

  /**
   * Returns a snapshot of the current `Time`, so a caller cannot write into the frame state.
   *
   * @returns A copy of the current `Time`.
   * @example
   * ```ts
   * // Stamp the start of a combo window in game time, which stands still during a pause.
   * const startedAt = app.time.snapshot().elapsed; // 1600
   * app.time.snapshot(); // { delta: 16, elapsed: 1600, scale: 1, frame: 100 }
   * ```
   */
  snapshot(): Readonly<Time>;

  /**
   * Sets the time scale. Every frame delta is multiplied by it; 0 freezes the game time
   * while the frames keep running. A negative scale is clamped to 0.
   *
   * @param scale - New time scale, 0 or greater.
   * @example
   * ```ts
   * // Slow motion while the last match of the level resolves.
   * app.time.setScale(0.5); // a frame of 20 ms now has delta 10
   * app.time.setScale(1);
   * ```
   */
  setScale(scale: number): void;

  /**
   * Pauses the clock: no phase runs and `elapsed` stops advancing. Called by `lifecycle`.
   *
   * @remarks No example: a game pauses through `app.lifecycle.push(reason)`; only `lifecycle`
   * calls this.
   */
  pause(): void;

  /**
   * Resumes the clock and drops the stale timestamp, so the first frame after the pause has
   * a normal delta instead of the whole pause. Called by `lifecycle`.
   *
   * @remarks No example: a game resumes through `app.lifecycle.pop(reason)`; only `lifecycle`
   * calls this.
   */
  resume(): void;

  /**
   * Tells whether the clock is paused.
   *
   * @returns True while paused.
   * @example
   * ```ts
   * // A test checks that a pause reason really stopped the frames.
   * app.lifecycle.push("background");
   * app.time.isPaused(); // true
   * ```
   */
  isPaused(): boolean;

  /**
   * Tells whether a real frame source drives the loop. False in plain Bun, where a test
   * drives the frames with `step`.
   *
   * @returns True while the loop runs.
   * @example
   * ```ts
   * // Without a frame source no frame ever comes: finish the fly-in at once instead of waiting.
   * if (!app.time.isRunning()) coin.moveTo(target); // false in plain Bun, true in a browser
   * ```
   */
  isRunning(): boolean;

  /**
   * Runs exactly one frame with the given unscaled delta, ignoring the fps cap, the pause
   * flag and `maxDeltaMs`. The time scale still applies. For tests and tools.
   *
   * @param deltaMs - Unscaled delta of the frame in milliseconds.
   * @throws {Error} When called from inside a frame callback.
   * @example
   * ```ts
   * // A test plays two frames without a browser.
   * app.time.step(16);
   * app.time.step(4);
   * app.time.snapshot(); // { delta: 4, elapsed: 20, scale: 1, frame: 2 }
   * ```
   */
  step(deltaMs: number): void;
};

/**
 * Domain context of the time plugin.
 */
export type TimeCtx = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
};
