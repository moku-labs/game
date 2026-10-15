/**
 * @file time plugin — type definitions.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { NativeShell } from "./native";

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
 * The Time resource, in scaled milliseconds. `idle` tells whether the loop currently runs at the
 * lowered idle cap.
 *
 * @example
 * ```ts
 * const time: Time = { delta: 16, elapsed: 1600, scale: 1, frame: 100, idle: false };
 * ```
 */
export type Time = {
  delta: number;
  elapsed: number;
  scale: number;
  frame: number;
  idle: boolean;
};

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
 * The adaptive frame rate of `time`: the lowest rate the rule may choose.
 *
 * @example
 * ```ts
 * defineGameApp({ flow: mainFlow, player, session, pluginConfigs: { time: { maxFps: 120, adaptive: { floor: 60 } } } });
 * ```
 */
export type AdaptiveRate = { floor: 30 | 60 };

/**
 * Who decides the rate: `"fixed"` (`maxFps`, no adaptive), `"auto"` (the adaptive rule), `"forced"` (`setRate` with
 * a number).
 *
 * @example
 * ```ts
 * app.time.rate().mode; // "auto" with adaptive, "fixed" without, "forced" after app.time.setRate(60)
 * ```
 */
export type RateMode = "fixed" | "auto" | "forced";

/**
 * Why the rate is what it is, the reason of the last change: `"start"` (nothing changed it yet), `"display"` (the
 * display rate became known or changed), `"missed"` (drawn frames came late), `"headroom"` (a return after steady
 * room), `"thermal"` (the native shell reported heat), `"forced"` / `"auto"` (`setRate`).
 *
 * @example
 * ```ts
 * app.time.rate().reason; // "missed" on the memory screen of a weak phone
 * ```
 */
export type RateReason =
  | "start"
  | "display"
  | "missed"
  | "headroom"
  | "thermal"
  | "forced"
  | "auto";

/**
 * What `setRate` takes: a fixed rate, or `"auto"` to give the rate back to the config.
 *
 * @example
 * ```ts
 * const choice: RateChoice = "auto"; // the player's "Auto" in the settings
 * ```
 */
export type RateChoice = "auto" | 30 | 60 | 120;

/**
 * The native shell's thermal status, normalized (Android `PowerManager.THERMAL_STATUS_*` 0–6 map in order).
 *
 * @example
 * ```ts
 * app.time.rate().thermal; // "moderate" on a warm A26
 * ```
 */
export type ThermalStatus =
  | "none"
  | "light"
  | "moderate"
  | "severe"
  | "critical"
  | "emergency"
  | "shutdown";

/**
 * The loop's frame rate as `app.time.rate()` answers it. One frozen object, rebuilt only when something in it changes.
 *
 * @example
 * ```ts
 * app.time.rate(); // { fps: 60, mode: "auto", reason: "missed", displayHz: 120, ladder: [120, 60], thermal: "none" }
 * ```
 */
export type FrameRate = {
  /** Frames per second the loop runs at, the idle cap left out. */
  fps: number;
  /** Who decides the rate. */
  mode: RateMode;
  /** Why the rate is what it is. */
  reason: RateReason;
  /** Refresh rate of the display in Hz: learned from the frame ticks or the native shell (`maxHz`); `null` until known, and always without `adaptive`. */
  displayHz: number | null;
  /** The rates the adaptive rule chooses from, highest first; empty until `displayHz` is known, and without `adaptive`. */
  ladder: readonly number[];
  /** The native shell's last thermal status; `null` without a shell, before its first reading, and without `adaptive`. */
  thermal: ThermalStatus | null;
};

/**
 * Payload of `time:rate`: a change of the loop's rate or of its mode, with the evidence the rule read.
 *
 * @example
 * ```ts
 * const change: RateChange = { from: 120, to: 60, reason: "missed", mode: "auto", displayHz: 120, thermal: "none", window: { drawn: 41, missed: 9, heavy: 0 }, dwellMs: 5000 };
 * ```
 */
export type RateChange = {
  /** The rate before the change. */
  from: number;
  /** The rate after it. */
  to: number;
  /** Why it changed. */
  reason: RateReason;
  /** Who decides the rate after it. */
  mode: RateMode;
  /** The display rate the rule knew; `null` until known and without `adaptive`. */
  displayHz: number | null;
  /** The shell's last thermal status; `null` without one and without `adaptive`. */
  thermal: ThermalStatus | null;
  /** Drawn intervals, the late ones and the heavy ones of the window the rule read; zeros for a reason that reads none. */
  window: { drawn: number; missed: number; heavy: number };
  /** How long a return must now wait at the lower rate, ms; 0 without `adaptive`. */
  dwellMs: number;
};

/**
 * What `time` measured of one frame, handed to the measure listeners after the `render` phase. One object, rewritten
 * every frame: copy the numbers you keep.
 *
 * @example
 * ```ts
 * // a 120 Hz frame of the board in a debug build:
 * const frame: FrameMeasure = { frame: 4812, at: 40123.5, gapMs: 8.3, capMs: 8.33, rateMs: 8.33, skipped: 0, startMs: 0.2, phaseMs: Float32Array.of(0.3, 0.1, 0.1, 0.4, 0.1, 2.2), workMs: 3.4, listenersMs: 0.05, idle: false, stepped: false };
 * ```
 */
export type FrameMeasure = {
  /** `Time.frame` of the measured frame. */
  frame: number;
  /** Start of the frame on the page clock (`performance` timeline), ms: the `requestAnimationFrame` timestamp, or the moment `step()` began. */
  at: number;
  /** `at` minus `at` of the previous measured frame; `NaN` for the first frame, the first after `resume()`, and a stepped frame. */
  gapMs: number;
  /** `1000 / cap` of this frame: the loop's rate, or `idleFps` while idle. */
  capMs: number;
  /** `1000 / fps` of the loop's rate in this frame, the idle cap left out: `1000 / time.rate().fps`. */
  rateMs: number;
  /** `requestAnimationFrame` ticks the cap skipped since the previous measured frame. */
  skipped: number;
  /** From `at` to the first phase callback: the browser's delay and the events it dispatched first; 0 for a stepped frame. */
  startMs: number;
  /** Duration of each phase, ms, in `PHASES` order: input, animate, layout, sync, signals, render. Length 6. */
  phaseMs: Float32Array;
  /** From `at` to the end of the `render` phase. */
  workMs: number;
  /** What the measure listeners took on the previous frame, ms; 0 on the first. */
  listenersMs: number;
  /** The frame ran under the idle cap. */
  idle: boolean;
  /** The frame came from `step()`, not from the frame source. */
  stepped: boolean;
};

/**
 * A listener of `time.measure`: called after the `render` phase of every frame of an agent build.
 *
 * @example
 * ```ts
 * const listener: MeasureListener = frame => ring.commit(frame);
 * ```
 */
export type MeasureListener = (frame: Readonly<FrameMeasure>) => void;

/**
 * The measure state of an agent build: the listeners, the one reused record and what the next frame needs of the
 * last one. Not public: exported for `measure.ts`.
 */
export type MeasureState = {
  /** Copy-on-write, as `callbacks`. */
  listeners: MeasureListener[];
  /** The one reused object; `phaseMs` is `new Float32Array(6)`. */
  record: FrameMeasure;
  /** NaN until the first measured frame and after `resume()`. */
  lastAt: number;
  /** Ticks skipped since the last run frame. */
  skipped: number;
  /** Cost of the listeners on the last frame. */
  listenersMs: number;
  /** The agent's spans charged to the running frame by `chargeAgent`; 0 at creation. */
  agentMs: number;
};

/**
 * A thermal reading of the native shell, normalized: Android's status and headroom, and the time it was read.
 *
 * @example
 * ```ts
 * const reading: ThermalReading = { status: 2, headroom: 0.71, at: 1791986083963, android: null };
 * ```
 */
export type ThermalReading = {
  status: number | string | null;
  headroom: number | null;
  at: number | null;
  android: {
    status: number | string | null;
    headroom: number | null;
    forecastSeconds: number | null;
  } | null;
};

/**
 * Events of `time`.
 *
 * @example
 * ```ts
 * // A game plugin notes the phone's temperature in its own log.
 * createPlugin("heat", {
 *   depends: [timePlugin],
 *   hooks: ctx => ({
 *     "time:thermal": reading => ctx.log.info("phone temperature", { status: reading.status }),
 *     "time:rate": ({ from, to, reason }) => ctx.log.info("frame rate", { from, to, reason })
 *   })
 * }); // a reading of the shell logs { status: 2 }; a drop logs { from: 120, to: 60, reason: "missed" }
 * ```
 */
export type Events = {
  /**
   * The native shell reported a thermal reading (`moku-native:thermal`), while `time` listens: on
   * the native shell, in an agent build or with `adaptive`. Never per frame.
   */
  "time:thermal": ThermalReading;
  /**
   * The loop's frame rate or its mode changed (the adaptive rule, the display, the thermal input or `setRate`).
   * Never per frame, never at start.
   */
  "time:rate": RateChange;
};

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
   * Android today; WKWebView on iOS and macOS is capped at 60 by WebKit (bug 294338). With
   * `adaptive`, the top of the ladder: the highest divisor of the display rate at or below it (120
   * on a 120 Hz panel, 60 on a 60 Hz one, 72 on a 144 Hz one).
   */
  maxFps: 30 | 60 | 120;
  /**
   * Upper bound of one frame's delta in milliseconds.
   */
  maxDeltaMs: number;
  /**
   * Frame rate cap of an idle screen, when nothing woke the clock for `idleAfterMs`. The default
   * is 30; 0 turns the idle cap off and every frame runs at `maxFps`.
   */
  idleFps: 0 | 30;
  /**
   * Unscaled milliseconds without a `wake()` after which the loop drops to `idleFps`.
   */
  idleAfterMs: number;
  /**
   * Adaptive frame rate. `false` (the default): the loop runs at `maxFps`, as before. With `{ floor }` the loop runs
   * at the highest divisor of the display's refresh rate at or below `maxFps`, drops to the next divisor when drawn
   * frames come late, and returns when there is room again; never below `floor`. Off in a headless app and on a fake
   * clock.
   */
  adaptive: false | AdaptiveRate;
};

/**
 * time plugin state.
 */
export type State = {
  callbacks: Record<Phase, FrameCallback[]>;
  /**
   * Scratch tuple of a frame: the six callback lists as they were when the frame started, in
   * `PHASES` order.
   */
  captured: CapturedPhases;
  time: Time;
  paused: boolean;
  running: boolean;
  /**
   * True while a frame runs; guards `step` re-entry.
   */
  stepping: boolean;
  rafId: number | undefined;
  lastTimestamp: number | undefined;
  /**
   * Elapsed time of the frame source in unscaled milliseconds, the clock of the idle timer: it
   * keeps running while `scale` is 0.
   */
  unscaledElapsedMs: number;
  /**
   * Unscaled elapsed time of the last wake.
   */
  lastWakeMs: number;
  /**
   * Wakes since the app started, `resume` included: the renderer draws the frame after any wake.
   */
  wakes: number;
  /**
   * True while the loop runs at `idleFps`.
   */
  idle: boolean;
  /**
   * What an agent build measures of every frame; `undefined` in a build without the flag.
   */
  measure: MeasureState | undefined;
  /**
   * What `time` holds of the native shell: the remover of the one thermal listener, and whether a
   * refused rate was warned about.
   */
  shell: ShellState;
  /**
   * The loop's frame rate, who decides it, and the adaptive rule.
   */
  rate: RateState;
};

/**
 * The six callback lists a frame captured, in `PHASES` order. Not public.
 */
export type CapturedPhases = [
  readonly FrameCallback[],
  readonly FrameCallback[],
  readonly FrameCallback[],
  readonly FrameCallback[],
  readonly FrameCallback[],
  readonly FrameCallback[]
];

/**
 * What `time` holds of the native shell. Not public.
 */
export type ShellState = {
  /** A refused frame rate was warned about once. */
  warned: boolean;
  /** Removes the one `moku-native:thermal` listener. */
  removeThermal: (() => void) | undefined;
};

/**
 * The loop's frame rate and what decides it. Not public: exported for `rate.ts`.
 */
export type RateState = {
  /** The loop's rate now; `maxFps` at creation. */
  fps: number;
  /** `"auto"` with `adaptive`, else `"fixed"`, until `setRate` forces a number. */
  mode: RateMode;
  /** The reason of the last change; `"start"` at creation. */
  reason: RateReason;
  /** `frameDrawn()` was called during the running frame. */
  drawnNow: boolean;
  /** `frameProbed()` was called during the running frame. */
  probedNow: boolean;
  /** What `rate()` answers: rebuilt and frozen on every change, so a read allocates nothing. */
  snapshot: Readonly<FrameRate>;
  /** The native shell found at start; `undefined` before start, after stop and without a shell. */
  native: NativeShell | undefined;
  /** The adaptive rule, allocated once when `adaptive` is configured; `undefined` otherwise. */
  governor: Governor | undefined;
};

/**
 * The numbers of the adaptive rule, allocated once: the display detection, the frame that ran last, the ring of
 * samples with the counts of its two windows, the dwell and the shell's requests. Not public: exported for `rate.ts`.
 */
export type Governor = {
  /** The lowest rate the rule may choose. */
  floor: number;
  /** The display's refresh rate; `null` until known. */
  displayHz: number | null;
  /** The rates the rule chooses from, highest first, frozen; empty until `displayHz` is known. */
  ladder: readonly number[];
  /** The shell's last thermal status; `null` before the first reading. */
  thermal: ThermalStatus | null;
  /** Timestamp of the last tick of the frame source; NaN at creation and after `resume()`. */
  lastTickAt: number;
  /** Ticks counted in the display window that is open. */
  ticks: number;
  /** Ticks of the open window per rate of `DISPLAY_RATES`. */
  tickCounts: Uint16Array;
  /** Windows in a row that saw a display rate below `displayHz`. */
  lowerStreak: number;
  /** The frame that ran last was drawn. */
  lastDrawn: boolean;
  /** The frame that ran last ran under the idle cap. */
  lastIdle: boolean;
  /** The frame that ran last drew warm-up probes. */
  lastProbed: boolean;
  /** Work of the frame that ran last, ms, the agent's own span left out. */
  lastWorkMs: number;
  /** The rate the frame that ran last ran at. */
  lastFps: number;
  /** The next interval is not judged: set at creation, at every switch and at `resume()`. */
  skipNext: boolean;
  /** Timestamp of each sample, a ring of `RING`. */
  sampleAt: Float64Array;
  /** Flags of each sample: bit 0 missed, bit 1 heavy. */
  sampleFlags: Uint8Array;
  /** Samples written since creation: the next slot is `written % RING`. */
  written: number;
  /** The oldest sample of the drop window. */
  dropTail: number;
  /** Samples in the drop window. */
  dropDrawn: number;
  /** Late samples in the drop window. */
  dropMissed: number;
  /** The oldest sample of the return window. */
  returnTail: number;
  /** Samples in the return window. */
  returnDrawn: number;
  /** Late samples in the return window. */
  returnMissed: number;
  /** Heavy samples in the return window. */
  returnHeavy: number;
  /** When the rate or its mode last changed. */
  switchedAt: number;
  /** When the rule last returned a step up; -Infinity before the first return. */
  lastReturnAt: number;
  /** How long a return waits after a switch, ms. */
  dwellMs: number;
  /** The rate last asked of the shell. */
  requested: number;
  /** Sequence number of the last request: an answer to an older one is stale. */
  requestSeq: number;
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
 * app.time.step(16);
 * // the callback gets { delta: 16, elapsed: 16, scale: 1, frame: 1, idle: false }
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
   * app.time.snapshot(); // { delta: 16, elapsed: 1600, scale: 1, frame: 100, idle: false }
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
   * @example
   * ```ts
   * // The lifecycle plugin owns the pause policy: the first pause reason stops the clock.
   * // A game pauses through app.lifecycle.push(reason), never here.
   * const time = ctx.require(timePlugin);
   * if (reasons.length === 1) time.pause(); // app.time.isPaused() is true, no phase runs
   * ```
   */
  pause(): void;

  /**
   * Resumes the clock and drops the stale timestamp, so the first frame after the pause has
   * a normal delta instead of the whole pause. Called by `lifecycle`.
   *
   * @example
   * ```ts
   * // The lifecycle plugin resumes when the last pause reason is gone.
   * const time = ctx.require(timePlugin);
   * if (reasons.length === 0) time.resume(); // the next frame has a normal delta, not the whole pause
   * ```
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
   * Resets the idle timer: the next frame runs at the loop's rate again, even after a long idle. Cheap,
   * idempotent and safe inside a frame callback. Every plugin that gives the player something to
   * look at calls it: a pointer sample, a starting animation, a flow edge, a finished load, a
   * scene switch, a locale change, a reconcile.
   *
   * @example
   * ```ts
   * // The flow runner walked an edge, so the screen has work again and the cap goes back up.
   * const time = ctx.require(timePlugin);
   *
   * time.wake(); // app.time.snapshot().idle is false from here on
   * ```
   */
  wake(): void;

  /**
   * How many wakes the clock has had since the app started, `resume` included. A plugin that must notice a wake
   * between two of its own frames compares two readings: the renderer draws the frame after any wake.
   *
   * @returns The count; it only grows.
   * @example
   * ```ts
   * const time = ctx.require(timePlugin);
   * time.wakes(); // 41
   * time.wake();
   * time.wakes(); // 42
   * ```
   */
  wakes(): number;

  /**
   * Hands what `time` measured of every frame to `listener`, after the `render` phase: the gap, the skipped ticks, the
   * six phase durations and the whole work. Agent builds only (`__MOKU_GAME_AGENT__`, true in dev and `--debug`
   * builds): without the flag nothing is measured, the listener is never called and the returned function does
   * nothing. The record is one object rewritten every frame.
   *
   * @param listener - Called once per frame with the record.
   * @returns The unsubscribe; a second call does nothing.
   * @example
   * ```ts
   * // The renderer's monitor keeps every frame of a debug build in its ring.
   * const off = ctx.require(timePlugin).measure(frame => ring.commit(frame));
   * // a 120 Hz frame of the board: frame.gapMs 8.3, frame.workMs 3.4, frame.phaseMs[5] 2.2 (render)
   * off(); // the renderer stopped
   * ```
   */
  measure(listener: MeasureListener): () => void;

  /**
   * The page clock for measurement, in an agent build (`__MOKU_GAME_AGENT__`: dev and `--debug` builds): milliseconds
   * of `performance.now()`. `undefined` in a build without the flag, so a plugin that times its work keeps one branch
   * and a release bundle keeps none of it. Never for game logic: the game's time is `snapshot()`.
   *
   * @returns The clock, or `undefined`.
   * @example
   * ```ts
   * // world, at start: time each system run of a debug build.
   * const clock = ctx.require(timePlugin).agentClock();
   * clock?.(); // 40123.52 on a debug page; clock is undefined on the store build
   * ```
   */
  agentClock(): (() => number) | undefined;

  /**
   * Charges `ms` of the editor's own work (its overlay, its page agent) to the frame running now, so the adaptive
   * frame rate leaves it out of that frame's work. Agent builds only (`__MOKU_GAME_AGENT__`, true in dev and
   * `--debug` builds): without the flag it does nothing. The renderer's monitor calls it when an agent span closes.
   *
   * @param ms - The span the agent just closed, ms.
   * @example
   * ```ts
   * // The renderer's monitor, when the overlay closes a span of 0.07 ms:
   * ctx.require(timePlugin).chargeAgent(0.07); // the adaptive rate reads this frame's work 0.07 ms smaller
   * ```
   */
  chargeAgent(ms: number): void;

  /**
   * The loop's frame rate now: the rate, who decides it, why it is what it is, the display rate and the ladder the
   * adaptive rule chooses from, and the native shell's thermal status. One frozen object, the same until something in
   * it changes: cheap to read every frame.
   *
   * @returns The frame rate.
   * @example
   * ```ts
   * // The settings screen shows the rate the game runs at on this phone.
   * app.time.rate(); // { fps: 120, mode: "auto", reason: "start", displayHz: 120, ladder: [120, 60], thermal: "none" }
   * // on the memory screen of a weak phone, a second later:
   * app.time.rate(); // { fps: 60, mode: "auto", reason: "missed", displayHz: 120, ladder: [120, 60], thermal: "none" }
   * ```
   */
  rate(): Readonly<FrameRate>;

  /**
   * Forces the frame rate, or gives it back with `"auto"`. A number is the cap from now on, like a `maxFps` of that
   * value (never above `maxFps`): the adaptive rule and the thermal input leave it alone. `"auto"` hands the rate back
   * to the config: the top of the adaptive ladder (a step lower while the shell reports heat), or `maxFps` without
   * `adaptive`. A choice equal to the current one changes nothing, so a game may apply its player's setting on every
   * commit. Every change emits `time:rate` and asks the native shell for the panel rate.
   *
   * @param choice - `"auto"`, 30, 60 or 120.
   * @returns The frame rate after the call.
   * @throws {Error} When `choice` is none of them.
   * @example
   * ```ts
   * // The player picked "60" in the settings to save battery.
   * app.time.setRate(60); // { fps: 60, mode: "forced", reason: "forced", displayHz: 120, ladder: [120, 60], thermal: "none" }
   * // …and later "Auto" again, on a 120 Hz phone:
   * app.time.setRate("auto"); // { fps: 120, mode: "auto", reason: "auto", displayHz: 120, ladder: [120, 60], thermal: "none" }
   * ```
   */
  setRate(choice: RateChoice): Readonly<FrameRate>;

  /**
   * Tells the clock that the frame running now was drawn. For engine plugins: the renderer calls it from its `render`
   * phase after Pixi drew; a frame without it — a still screen under `onDemand` — never counts for the adaptive
   * rate, so a screen at rest is never taken for a slow one. One assignment; a stepped frame forgets it.
   *
   * @example
   * ```ts
   * // The renderer's render phase: Pixi drew this frame, so its interval counts.
   * if (drawn && modules.host.render()) ctx.require(timePlugin).frameDrawn();
   * ```
   */
  frameDrawn(): void;

  /**
   * Tells the clock that the frame running now also drew warm-up probes (it created pipelines). For engine plugins:
   * such a frame is drawn, but its interval is never a sample of the adaptive rate, so the compile frames of a load
   * never drop the rate. One assignment; a stepped frame forgets it.
   *
   * @example
   * ```ts
   * // The renderer's render phase, on a frame that also created pipelines for the warm-up:
   * const time = ctx.require(timePlugin);
   * time.frameDrawn();
   * time.frameProbed(); // drawn, but its interval never counts for the adaptive rate
   * ```
   */
  frameProbed(): void;

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
   * app.time.snapshot(); // { delta: 4, elapsed: 20, scale: 1, frame: 2, idle: false }
   * ```
   */
  step(deltaMs: number): void;
};

/**
 * Domain context of the time plugin.
 */
export type TimeCtx = PluginCtx<Config, State, Events> & {
  readonly global: object;
  readonly log: Log.LogApi;
};
