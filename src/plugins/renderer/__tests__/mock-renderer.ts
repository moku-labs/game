/**
 * @file renderer plugin — shared mock kernel context for the unit tests. Not a test file: the
 * projects only collect `*.test.ts`. The real `host`, `viewport` and `sync` modules run over a
 * real `world`, a fake `time`, a fake `lifecycle`, the fake Pixi module and the fake DOM.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../config";
import type { Api as ClockApi } from "../../clock/types";
import type { Api as FlowApi } from "../../flow/types";
import type { Api as LifecycleApi, PauseReason } from "../../lifecycle/types";
import type { Json, Api as ModelApi, Snapshot } from "../../model/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../time/types";
import { createModules as createWorldModules } from "../../world/api";
import { createWorldState } from "../../world/state";
import type { Api as WorldApi, KernelSlice as WorldKernelSlice } from "../../world/types";
import { createModules, createRendererApi } from "../api";
import { startRenderer, stopRenderer, withDeps } from "../lifecycle";
import { createRendererState } from "../state";
import type { Api, Config, KernelSlice, Modules } from "../types";
import { type FakeDom, installFakeDom } from "./fake-dom";
import { createFakePixi, type FakePixi } from "./fake-pixi";

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** The mock renderer: the modules, the fakes behind them and the drivers a test uses. */
export type MockRenderer = {
  ctx: KernelSlice;
  api: Api;
  modules: Modules;
  world: WorldApi & { clearChanges(): void };
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  pixi: FakePixi;
  dom: FakeDom | undefined;
  frames: FrameRegistration[];
  /** Every `lifecycle.push` and `lifecycle.pop`, in call order. */
  pauses: Array<{ action: "push" | "pop"; reason: PauseReason }>;
  /** Sets what the fake `clock.now()` answers, in milliseconds. */
  setNow(ms: number): void;
  /** Sets what the fake `time.isPaused()` answers. */
  setPaused(paused: boolean): void;
  /** Runs `onStart`. */
  start(): Promise<void>;
  /** Runs every callback of one phase. */
  runPhase(phase: Phase): void;
  /** Runs `onStop`. */
  stop(): void;
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
 * The frozen model snapshot the fake `model` hands the world.
 *
 * @returns An empty snapshot.
 */
function emptySnapshot(): Snapshot {
  return { player: {} as Json, session: {} as Json, rng: { seed: 1, streams: {} } };
}

/**
 * Counts nothing. Stands in for the remover a hint listener gets back, which the world never
 * calls in these tests.
 *
 * @returns Always 0.
 */
function noop(): number {
  return 0;
}

/**
 * The remover a hint listener gets back.
 *
 * @returns A remover that does nothing.
 */
function noRemover(): () => void {
  return noop;
}

/**
 * Builds a real `world` API over fake `time`, `model` and `flow` APIs.
 *
 * @param timeApi - The fake time API the world shares with the renderer.
 * @param log - The mock log.
 * @returns The world API plus the internal change-set clear.
 */
function createWorld(timeApi: TimeApi, log: Log.LogApi): WorldApi & { clearChanges(): void } {
  const modelApi = {
    store: { snapshot: emptySnapshot },
    rng: { peek: vi.fn() }
  } as unknown as ModelApi;
  const flowApi = {
    state: () => ({ mode: "live" }),
    features: { all: () => [] },
    fx: { onHint: noRemover }
  } as unknown as FlowApi;
  const apis: Record<string, unknown> = { time: timeApi, model: modelApi, flow: flowApi };
  const config = { settleMs: 350, reconciledEvent: false };
  const kernel = {
    config,
    state: createWorldState({ config }),
    emit: () => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  } as unknown as WorldKernelSlice;
  const modules = createWorldModules({
    ...kernel,
    deps: { time: timeApi, model: modelApi, flow: flowApi }
  });

  return {
    ecs: modules.ecs,
    projection: modules.projection,
    clearChanges: () => modules.ecs.clearChanges()
  };
}

/**
 * Creates the mock renderer.
 *
 * @param options - What the fakes should do.
 * @param options.dom - False to leave `globalThis.document` absent, which keeps the plugin inert.
 * @param options.config - Config overrides of the plugin.
 * @param options.kind - Backend the fake Pixi renderer reports.
 * @param options.failInit - True to make the fake `Application.init` reject.
 * @param options.width - CSS width of the fake mount.
 * @param options.height - CSS height of the fake mount.
 * @param options.mountElement - True to pass the element itself instead of a selector.
 * @param options.orientation - The orientation the game is designed for.
 * @param options.referenceLong - The long side the layout needs inside the safe area.
 * @returns The context, the modules, the fakes and the drivers.
 */
export function createMockRenderer(
  options: {
    dom?: boolean;
    config?: Partial<Config>;
    kind?: "webgpu" | "webgl";
    failInit?: boolean;
    width?: number;
    height?: number;
    mountElement?: boolean;
    orientation?: "portrait" | "landscape";
    referenceLong?: number;
  } = {}
): MockRenderer {
  const pixi = createFakePixi({
    kind: options.kind ?? "webgpu",
    failInit: options.failInit ?? false
  });
  const dom =
    options.dom === false
      ? undefined
      : installFakeDom({ width: options.width ?? 1080, height: options.height ?? 1920 });
  const selector = options.mountElement === true ? undefined : "#game";
  const config: Config = {
    mount: dom === undefined ? undefined : (selector ?? (dom.mount as unknown as HTMLElement)),
    background: 0x00_00_00,
    antialias: false,
    maxResolution: 2,
    preference: "webgpu",
    aspect: { min: 4 / 3, max: 21 / 9 },
    poolLimit: 256,
    unsupportedMessage: "This device cannot run the game.",
    loadPixi: () => Promise.resolve(pixi.module),
    debug: { nineSlice: false },
    ...options.config
  };
  const state = createRendererState({ config });
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const frames: FrameRegistration[] = [];
  const pauses: Array<{ action: "push" | "pop"; reason: PauseReason }> = [];
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };
  const clock = { now: 0, paused: false };

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
    isPaused: () => clock.paused,
    isRunning: () => false,
    step: vi.fn()
  } as unknown as TimeApi;

  const clockApi = { now: () => clock.now } as unknown as ClockApi;

  const lifecycleApi = {
    push: (reason: PauseReason) => pauses.push({ action: "push", reason }),
    pop: (reason: PauseReason) => pauses.push({ action: "pop", reason }),
    reasons: () => [],
    isPaused: () => false
  } as unknown as LifecycleApi;

  const world = createWorld(timeApi, log);
  const apis: Record<string, unknown> = {
    time: timeApi,
    lifecycle: lifecycleApi,
    world,
    clock: clockApi
  };

  const ctx: KernelSlice = {
    config,
    state,
    emit: (name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    },
    global: {
      orientation: options.orientation ?? "portrait",
      referenceSide: 1080,
      referenceLong: options.referenceLong ?? 1920
    },
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  } as unknown as KernelSlice;

  const modules = createModules(withDeps(ctx));

  return {
    ctx,
    api: createRendererApi(ctx),
    modules,
    world,
    log,
    emitted,
    pixi,
    dom,
    frames,
    pauses,
    setNow: (ms: number): void => {
      clock.now = ms;
    },
    setPaused: (paused: boolean): void => {
      clock.paused = paused;
    },
    start: () => startRenderer(ctx),
    runPhase: (phase: Phase): void => {
      time.frame += 1;
      for (const registration of frames) {
        if (registration.phase === phase) registration.callback({ ...time });
      }
    },
    stop: () => stopRenderer({ config, state })
  };
}
