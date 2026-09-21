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
 * const config: Config = { maxFps: 60, maxDeltaMs: 50 };
 * ```
 */
export type Config = {
  /**
   * Frame rate cap.
   */
  maxFps: 30 | 60;
  /**
   * Upper bound of one frame's delta in milliseconds.
   */
  maxDeltaMs: number;
};

/**
 * time plugin state.
 *
 * @example
 * ```ts
 * const state: State = createTimeState({ global, config });
 * ```
 */
export type State = {
  callbacks: Record<Phase, FrameCallback[]>;
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
 * time plugin API.
 *
 * @example
 * ```ts
 * const time: Api = ctx.require(timePlugin);
 * const off = time.onFrame("animate", advanceTweens);
 * ```
 */
export type Api = {
  onFrame(phase: Phase, callback: FrameCallback): () => void;
  read(): Readonly<Time>;
  setScale(scale: number): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  isRunning(): boolean;
  step(deltaMs: number): void;
};

/**
 * Domain context of the time plugin.
 *
 * @example
 * ```ts
 * const api = createTimeApi(ctx satisfies TimeCtx);
 * ```
 */
export type TimeCtx = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
};
