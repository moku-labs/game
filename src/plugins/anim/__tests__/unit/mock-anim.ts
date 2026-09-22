/**
 * @file anim plugin — shared mock kernel context for the unit tests. Not a test file: the unit
 * project only collects `*.test.ts`. The real `ecs` and `projection` modules of `world` run under
 * a fake `time` and a fake `flow`, and the real `anim` driver, cursor and API run over them.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Descriptor, Api as FlowApi, FxHandler, Hint } from "../../../flow/types";
import type { Json, Api as ModelApi, Snapshot } from "../../../model/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../../time/types";
import { createWorldApi } from "../../../world/api";
import { connectWorld } from "../../../world/lifecycle";
import { createWorldState } from "../../../world/state";
import type { Api as WorldApi, KernelSlice as WorldKernelSlice } from "../../../world/types";
import { createAnimApi } from "../../api";
import { initAnim, startAnim, withDeps } from "../../lifecycle";
import { createAnimState } from "../../state";
import type { AnimApi, AnimCtx, Config, KernelSlice, State } from "../../types";

const PHASE_ORDER: readonly Phase[] = ["input", "animate", "layout", "sync", "signals"];

/** The remover of a listener nothing ever calls. */
const noRemover = (): void => undefined;

/** One `time.onFrame` registration. */
type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** One registered `flow.fx` handler. */
export type RegisteredHandler = { run: FxHandler; runInFast: boolean };

/** The mock anim world: both plugin APIs, the fakes behind them and a frame driver. */
export type MockAnim = {
  ctx: KernelSlice;
  actx: AnimCtx;
  state: State;
  api: AnimApi;
  world: WorldApi;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  dispatched: Array<Descriptor | Hint>;
  handlers: Map<string, RegisteredHandler>;
  features: Array<{ name: string; description: FeatureDescription }>;
  /** How often `time.wake()` was called. */
  wakes: { count: number };
  time: Time;
  /** Runs `initAnim`, then `connectWorld`, then `startAnim`, as the kernel would. */
  start(): void;
  /** Runs one frame: every recorded callback, in phase order and registration order. */
  frame(deltaMs?: number): void;
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
 * Creates the mock anim world.
 *
 * @param options - Config overrides of the anim plugin.
 * @returns Both APIs, the fakes and the frame driver.
 */
export function createMockAnim(options: Partial<Config> = {}): MockAnim {
  const config: Config = { maxTracks: 2000, ...options };
  const state = createAnimState({ global: {}, config });
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const dispatched: Array<Descriptor | Hint> = [];
  const handlers = new Map<string, RegisteredHandler>();
  const features: Array<{ name: string; description: FeatureDescription }> = [];
  const frames: FrameRegistration[] = [];
  const wakes = { count: 0 };
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };
  const model: { player: Json; session: Json } = { player: {}, session: {} };

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
    wake: (): void => {
      wakes.count += 1;
    },
    step: vi.fn()
  } as unknown as TimeApi;

  const snapshot = (): Snapshot => ({
    player: model.player,
    session: model.session,
    rng: { seed: 1, streams: {} }
  });

  const modelApi = { store: { snapshot }, rng: { peek: vi.fn() } } as unknown as ModelApi;

  const flowApi = {
    state: () => ({ mode: "live" }),
    features: { all: () => features },
    fx: {
      onHint: (): (() => void) => noRemover,
      handle: (kind: string, run: FxHandler, handlerOptions?: { runInFast?: boolean }) => {
        handlers.set(kind, { run, runInFast: handlerOptions?.runInFast ?? false });

        return () => {
          handlers.delete(kind);
        };
      },
      dispatch: (descriptor: Descriptor | Hint): void => {
        dispatched.push(descriptor);
      }
    }
  } as unknown as FlowApi;

  const worldConfig = { settleMs: 350, reconciledEvent: false };
  const worldState = createWorldState({ global: {}, config: worldConfig });
  const worldApis: Record<string, unknown> = { time: timeApi, model: modelApi, flow: flowApi };
  const worldCtx: WorldKernelSlice = {
    config: worldConfig,
    state: worldState,
    emit: (): void => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => worldApis[plugin.name]) as unknown as Require
  };
  const world = createWorldApi(worldCtx);

  const apis: Record<string, unknown> = { ...worldApis, world, renderer: {} };
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

  return {
    ctx,
    actx: withDeps(ctx),
    state,
    api: createAnimApi(ctx),
    world,
    log,
    emitted,
    dispatched,
    handlers,
    features,
    wakes,
    time,
    start: (): void => {
      initAnim(ctx);
      connectWorld(worldCtx);
      startAnim(ctx);
    },
    frame: (deltaMs = 16): void => {
      time.frame += 1;
      time.delta = deltaMs;
      time.elapsed += deltaMs;

      for (const phase of PHASE_ORDER) {
        // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
        for (const registration of [...frames]) {
          if (registration.phase === phase) registration.callback({ ...time });
        }
      }
    }
  };
}

/**
 * Spawns an entity owned by the test.
 *
 * @param mock - The mock anim world.
 * @param components - Component values the entity starts with.
 * @returns The new entity id.
 */
export function spawnTestEntity(
  mock: MockAnim,
  components: Parameters<WorldApi["ecs"]["spawn"]>[1]
): number {
  return mock.world.ecs.spawn({ kind: "plugin", name: "test" }, components);
}
