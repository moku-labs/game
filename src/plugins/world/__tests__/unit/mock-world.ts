/**
 * @file world plugin — shared mock kernel context for the unit tests. Not a test file: the unit
 * project only collects `*.test.ts`. The real `ecs` and `projection` modules run over a fake
 * `time`, `model` and `flow`; frames are driven by calling the recorded phase callbacks.
 */
import type { Log } from "@moku-labs/common/browser";
import { type Mock, vi } from "vitest";
import type { Require } from "../../../../config";
import { fakeClock } from "../../../clock/fake";
import type { Api as ClockApi, FakeClock } from "../../../clock/types";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Api as FlowApi, FlowGraph, FlowState, Hint } from "../../../flow/types";
import type { Json, Api as ModelApi, Root, Snapshot } from "../../../model/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../../time/types";
import { createWorldApi } from "../../api";
import { createHandlers } from "../../handlers";
import { connectWorld } from "../../lifecycle";
import type { Cause } from "../../projection/types";
import { createWorldState } from "../../state";
import type { Api, Config, KernelSlice } from "../../types";
import type { FakeDriver } from "./fake-driver";
import { createFakeDriver } from "./fake-driver";

const PHASE_ORDER: readonly Phase[] = ["input", "animate", "layout", "sync", "signals"];

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/**
 * The fake flow a test moves: the mode, the stack `state()` hands out and the node owners
 * `describe()` answers with. `state()` is memoised as the real one is: the same frozen object
 * until the mode changes or a test assigns a new `stack`.
 */
export type FakeFlow = {
  /** Effective flow mode, read by `ecs.mode()`. */
  mode: "live" | "fast";
  /** The stack frames; assign a new array to move the graph. */
  stack: FlowState["stack"];
  /** Flow id to node name to the feature that owns it, read by every `describe()`. */
  owners: Record<string, Record<string, string | undefined>>;
  /** The spy behind `describe()`; a case may make it throw. */
  describe: Mock<() => FlowGraph>;
};

/** The mock world: the plugin API, the fakes behind it and a frame driver. */
export type MockWorld = {
  ctx: KernelSlice;
  api: Api;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  /** The mutable model roots the fake `store.snapshot()` reads. */
  model: { player: Json; session: Json };
  /** The fake flow: mode, stack and node owners. */
  flow: FakeFlow;
  features: Array<{ name: string; description: FeatureDescription }>;
  frames: FrameRegistration[];
  time: Time;
  /** The game's clock the world reads `Now` from; a case moves it with `advance`. */
  clock: FakeClock;
  /** The tween driver installed on the world, advanced by `frame`. */
  driver: FakeDriver;
  /** Takes the driver back, so the world writes every target at once. */
  offDriver(): void;
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
 * The graph `describe()` answers with: one flow per owner table, each node with its owner.
 *
 * @param owners - Flow id to node name to owner.
 * @returns The described graph.
 */
function graphOf(owners: FakeFlow["owners"]): FlowGraph {
  const flows: FlowGraph["flows"] = {};

  for (const [id, nodes] of Object.entries(owners)) {
    const described: FlowGraph["flows"][string]["nodes"] = {};

    for (const [node, owner] of Object.entries(nodes)) {
      described[node] = {
        flow: id,
        node,
        rest: true,
        over: false,
        checkpoint: false,
        barrier: false,
        outcomes: [],
        ...(owner === undefined ? {} : { owner })
      };
    }

    flows[id] = { nodes: described, start: Object.keys(nodes)[0] ?? "", edges: {} };
  }

  return { main: Object.keys(owners)[0] ?? "", flows, slots: {} };
}

/**
 * Creates the fake flow and its memoised `state()`.
 *
 * @returns The fake and the `state()` the world reads.
 */
function createFakeFlow(): { flow: FakeFlow; state: () => FlowState } {
  const flow: FakeFlow = {
    mode: "live",
    stack: [],
    owners: {},
    describe: vi.fn((): FlowGraph => graphOf(flow.owners))
  };
  const memo: {
    mode: string;
    stack: FlowState["stack"] | undefined;
    state: FlowState | undefined;
  } = { mode: "", stack: undefined, state: undefined };

  const state = (): FlowState => {
    if (memo.state === undefined || memo.mode !== flow.mode || memo.stack !== flow.stack) {
      memo.mode = flow.mode;
      memo.stack = flow.stack;
      memo.state = Object.freeze({
        running: flow.stack.length > 0,
        path: "",
        stack: Object.freeze([...flow.stack]),
        pending: Object.freeze({}),
        mode: flow.mode
      });
    }

    return memo.state;
  };

  return { flow, state };
}

/**
 * Creates the mock world.
 *
 * @param options - Config overrides of the plugin.
 * @returns The context, the API, the fakes and the frame driver.
 */
export function createMockWorld(options: Partial<Config> = {}): MockWorld {
  const config: Config = { settleMs: 350, reconciledEvent: false, ...options };
  const state = createWorldState({ config });
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const model: { player: Json; session: Json } = { player: {}, session: {} };
  const { flow, state: flowState } = createFakeFlow();
  const features: Array<{ name: string; description: FeatureDescription }> = [];
  const frames: FrameRegistration[] = [];
  const hintListeners: Array<(hint: Hint) => void> = [];
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };

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
    step: vi.fn(),
    // An agent build asks for the page clock; a test that times systems hands one in.
    agentClock: () => undefined
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
    state: flowState,
    describe: () => flow.describe(),
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

  const clock = fakeClock(1_790_000_000_000);
  const clockApi = { now: () => clock.now() } as unknown as ClockApi;
  const apis: Record<string, unknown> = {
    time: timeApi,
    model: modelApi,
    flow: flowApi,
    clock: clockApi
  };

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
  const driver = createFakeDriver(api.ecs);
  const removeDriver = api.projection.setDriver(driver);

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
    clock,
    driver,
    offDriver: removeDriver,
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
        // `anim` registers its `time.onFrame("animate")` in onInit, before the world's callback:
        // the tracks move first, the sweep of the world sees what ended.
        if (phase === "animate" && api.ecs.mode() === "live") driver.step(deltaMs);

        for (const registration of frames) {
          if (registration.phase === phase) registration.callback({ ...time });
        }
      }
    }
  };
}
