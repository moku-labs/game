/**
 * @file world plugin — shared mock kernel context for the unit tests. Not a test file: the unit
 * project only collects `*.test.ts`. The real `ecs` and `projection` modules run over a fake
 * `time`, `model` and `flow`; frames are driven by calling the recorded phase callbacks.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Api as FlowApi, Hint } from "../../../flow/types";
import type { Json, Api as ModelApi, Root, Snapshot } from "../../../model/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../../time/types";
import { createWorldApi } from "../../api";
import { createHandlers } from "../../handlers";
import { connectWorld } from "../../lifecycle";
import type { Cause } from "../../projection/types";
import { createWorldState } from "../../state";
import type { Api, Config, KernelSlice } from "../../types";

const PHASE_ORDER: readonly Phase[] = ["input", "animate", "layout", "sync", "signals"];

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** The mock world: the plugin API, the fakes behind it and a frame driver. */
export type MockWorld = {
  ctx: KernelSlice;
  api: Api;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  /** The mutable model roots the fake `store.snapshot()` reads. */
  model: { player: Json; session: Json };
  /** Effective flow mode, read by `ecs.mode()`. */
  flow: { mode: "live" | "fast" };
  features: Array<{ name: string; description: FeatureDescription }>;
  frames: FrameRegistration[];
  time: Time;
  /** Fires the `model:committed` hook. */
  commit(cause?: Cause, roots?: readonly Root[]): void;
  /** Hands a hint to every `flow.fx.onHint` listener. */
  release(hint: Hint): void;
  /** Runs one frame: every recorded callback, in phase order. */
  frame(deltaMs?: number): void;
  /** Registers the features and the frame callbacks, as `onStart` does. */
  start(): void;
};

/**
 * Creates the engine log as spies.
 *
 * @returns A log whose every method is a spy.
 */
function createMockLog(): Log.LogApi {
  return {
    addSink: vi.fn(),
    clearSinks: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    expect: vi.fn(),
    info: vi.fn(),
    reset: vi.fn(),
    trace: vi.fn(() => []),
    warn: vi.fn()
  };
}

/**
 * Creates the mock world.
 *
 * @param options - Config overrides of the plugin.
 * @returns The context, the API, the fakes and the frame driver.
 */
export function createMockWorld(options: Partial<Config> = {}): MockWorld {
  const config: Config = { settleMs: 350, reconciledEvent: false, ...options };
  const state = createWorldState({ global: {}, config });
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const model: { player: Json; session: Json } = { player: {}, session: {} };
  const flow: { mode: "live" | "fast" } = { mode: "live" };
  const features: Array<{ name: string; description: FeatureDescription }> = [];
  const frames: FrameRegistration[] = [];
  const hintListeners: Array<(hint: Hint) => void> = [];
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0 };

  const timeApi = {
    onFrame: (phase: Phase, callback: FrameCallback): (() => void) => {
      const registration = { phase, callback };

      frames.push(registration);

      return () => {
        const at = frames.indexOf(registration);

        if (at !== -1) frames.splice(at, 1);
      };
    },
    snapshot: () => ({ ...time }),
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: () => false,
    isRunning: () => false,
    step: vi.fn()
  } as unknown as TimeApi;

  const snapshot = (): Snapshot => ({
    player: model.player,
    session: model.session,
    rng: { seed: 1, streams: {} }
  });

  const modelApi = {
    store: { snapshot },
    rng: { peek: vi.fn() }
  } as unknown as ModelApi;

  const flowApi = {
    state: () => ({ mode: flow.mode }),
    features: { all: () => features },
    fx: {
      onHint: (listener: (hint: Hint) => void): (() => void) => {
        hintListeners.push(listener);

        return () => {
          const at = hintListeners.indexOf(listener);

          if (at !== -1) hintListeners.splice(at, 1);
        };
      }
    }
  } as unknown as FlowApi;

  const apis: Record<string, unknown> = { time: timeApi, model: modelApi, flow: flowApi };

  const ctx: KernelSlice = {
    config,
    state,
    emit: (name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    },
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  const api = createWorldApi(ctx);

  return {
    ctx,
    api,
    log,
    emitted,
    model,
    flow,
    features,
    frames,
    time,
    start: (): void => {
      connectWorld(ctx);
    },
    commit: (cause: Cause = "edge", roots: readonly Root[] = ["player"]): void => {
      createHandlers(ctx)["model:committed"]({ roots, cause: cause as "edge" });
    },
    release: (hint: Hint): void => {
      for (const listener of hintListeners) listener(hint);
    },
    frame: (deltaMs = 16): void => {
      time.frame += 1;
      time.delta = deltaMs;
      time.elapsed += deltaMs;

      for (const phase of PHASE_ORDER) {
        for (const registration of frames) {
          if (registration.phase === phase) registration.callback({ ...time });
        }
      }
    }
  };
}
