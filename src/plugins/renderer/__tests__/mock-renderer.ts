/**
 * @file renderer plugin — shared mock kernel context for the unit tests. Not a test file: the
 * projects only collect `*.test.ts`. The real `host`, `viewport` and `sync` modules run over a
 * real `world`, a fake `time` (with `measure` driven by `measureFrame`), a fake `lifecycle`, a
 * fake `flow`, the fake Pixi module and the fake DOM.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../config";
import type { Api as ClockApi } from "../../clock/types";
import type { Api as FlowApi } from "../../flow/types";
import type { Api as LifecycleApi, PauseReason } from "../../lifecycle/types";
import type { Json, Api as ModelApi, Snapshot } from "../../model/types";
import { createRateState } from "../../time/rate";
import type {
  FrameCallback,
  FrameMeasure,
  FrameRate,
  MeasureListener,
  Phase,
  Time,
  Api as TimeApi
} from "../../time/types";
import { createModules as createWorldModules } from "../../world/api";
import { createWorldState } from "../../world/state";
import type {
  SystemTiming,
  Api as WorldApi,
  KernelSlice as WorldKernelSlice
} from "../../world/types";
import { createModules, createRendererApi } from "../api";
import { createHandlers } from "../handlers";
import { startRenderer, stopRenderer, withDeps } from "../lifecycle";
import { createRendererState } from "../state";
import type { Api, Config, KernelSlice, Modules } from "../types";
import { type FakeDom, installFakeDom } from "./fake-dom";
import { createFakePixi, type FakePixi, type FakeScene } from "./fake-pixi";

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** The real world of the mock, with the two drivers its own frame callbacks would run. */
export type MockWorld = WorldApi & {
  /** Empties the change sets, as the end of a world frame does. */
  clearChanges(): void;
  /** Starts the frame of a scene build at the world clock's now, as world's `input` callback does (`left()`). */
  startFrame(): void;
  /**
   * The rest of world's `input` callback after `startFrame`: the reconcile of a marked commit, then one step of the
   * warm windows (spec 33, slice B+D).
   */
  input(): void;
  /** Marks a commit of the session, as `model:committed` does: the next `input()` reconciles it. */
  commitSession(): void;
};

/** The mock renderer: the modules, the fakes behind them and the drivers a test uses. */
export type MockRenderer = {
  ctx: KernelSlice;
  api: Api;
  /** The hooks of the plugin, called by hand: the mock has no kernel to emit. */
  hooks: ReturnType<typeof createHandlers>;
  modules: Modules;
  world: MockWorld;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  pixi: FakePixi;
  dom: FakeDom | undefined;
  frames: FrameRegistration[];
  /** Every `lifecycle.push` and `lifecycle.pop`, in call order. */
  pauses: Array<{ action: "push" | "pop"; reason: PauseReason }>;
  /** The fake `time` the renderer reads: `step` is a spy that runs no frame. */
  time: TimeApi;
  /** Sets what the fake `clock.now()` answers, in milliseconds. */
  setNow(ms: number): void;
  /** Sets what the world's own clock answers, in milliseconds: the build start and `projection.left()` read it. */
  setWorldNow(ms: number): void;
  /** Sets the game time `time.snapshot().elapsed` answers, in milliseconds. */
  setElapsed(ms: number): void;
  /** Sets what the fake `time.isPaused()` answers. */
  setPaused(paused: boolean): void;
  /** Runs `onStart`. */
  start(): Promise<void>;
  /** Runs every callback of one phase. */
  runPhase(phase: Phase): void;
  /** Runs `onStop`. */
  stop(): void;
  /** The listeners of the fake `time.measure`. */
  measures: MeasureListener[];
  /** Every `time.chargeAgent` span, in call order. */
  charged: number[];
  /** How many times the renderer told the fake `time` that a frame was drawn. */
  drawnCount(): number;
  /** Sets the frame rate the fake `time.rate()` answers. */
  setRate(rate: Readonly<FrameRate>): void;
  /** Hands a measured frame to the `time.measure` listeners; the fields left out are of a quiet 60 fps frame. */
  measureFrame(record?: Partial<FrameMeasure>): void;
  /** Runs one frame: phase input, phase render, then the measure listeners with the record. */
  drawFrame(record?: Partial<FrameMeasure>): void;
  /** Sets the flow path the fake `flow.state()` answers. */
  setPath(path: string): void;
  /** Sets what the fake `world.systemTimes()` answers. */
  setSystemTimes(timing: SystemTiming | undefined): void;
  /** Sets what the fake `clock.pending()` and `clock.listeners()` answer. */
  setClockCounts(pending: number, listeners: number): void;
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
 * @param flowApi - The fake flow API the world and the renderer share.
 * @param log - The mock log.
 * @param systems - What the fake `systemTimes()` answers.
 * @param systems.timing - The timing table, or `undefined`.
 * @param clock - What the world's clock answers: 0 unless a test of a scene build moves it.
 * @param clock.now - The milliseconds it answers.
 * @returns The world API plus the internal change-set clear, the frame start of a build, the rest of the input step
 *   and the mark of a commit.
 */
function createWorld(
  timeApi: TimeApi,
  flowApi: FlowApi,
  log: Log.LogApi,
  systems: { timing: SystemTiming | undefined },
  clock: { now: number }
): MockWorld {
  const modelApi = {
    store: { snapshot: emptySnapshot },
    rng: { peek: vi.fn() }
  } as unknown as ModelApi;
  // World writes the frame's moment into its `Now` resource (spec 15): a still clock is enough here, moved only by the
  // tests of a scene build, whose budget world counts from it.
  const worldClock = { now: () => clock.now } as unknown as ClockApi;
  const apis: Record<string, unknown> = {
    time: timeApi,
    model: modelApi,
    flow: flowApi,
    clock: worldClock
  };
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
    deps: { time: timeApi, model: modelApi, flow: flowApi, clock: worldClock }
  });

  return {
    ecs: modules.ecs,
    projection: modules.projection,
    systemTimes: () => systems.timing,
    clearChanges: () => modules.ecs.clearChanges(),
    startFrame: () => modules.projection.startFrame(clock.now),
    input: () => {
      modules.projection.reconcileIfDirty();
      modules.projection.stepWarm();
    },
    commitSession: () => modules.projection.markDirty(["session"], "edge")
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
 * @param options.dpr - What `devicePixelRatio` answers; 1 when left out.
 * @param options.mountElement - True to pass the element itself instead of a selector.
 * @param options.orientation - The orientation the game is designed for.
 * @param options.referenceLong - The long side the layout needs inside the safe area.
 * @param options.scene - What every WebGPU frame of the fake Pixi draws.
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
    dpr?: number;
    mountElement?: boolean;
    orientation?: "portrait" | "landscape";
    referenceLong?: number;
    scene?: Partial<FakeScene>;
  } = {}
): MockRenderer {
  const pixi = createFakePixi({
    kind: options.kind ?? "webgpu",
    failInit: options.failInit ?? false,
    ...(options.scene === undefined ? {} : { scene: options.scene })
  });
  const dom =
    options.dom === false
      ? undefined
      : installFakeDom({
          width: options.width ?? 1080,
          height: options.height ?? 1920,
          dpr: options.dpr ?? 1
        });
  const selector = options.mountElement === true ? undefined : "#game";
  const config: Config = {
    mount: dom === undefined ? undefined : (selector ?? (dom.mount as unknown as HTMLElement)),
    background: 0x00_00_00,
    antialias: false,
    maxResolution: 2,
    poolTrim: { restMs: 1000, aboveMb: 16 },
    preference: "webgpu",
    aspect: { min: 4 / 3, max: 21 / 9 },
    poolLimit: 256,
    unsupportedMessage: "This device cannot run the game.",
    loadPixi: () => Promise.resolve(pixi.module),
    debug: { nineSlice: false, verifyFrames: false },
    monitor: { budgetMs: "rate", frames: 1024 },
    onDemand: false,
    keptMb: 64,
    // The warm-up draws probes for its first frames (F4): the tests of other behaviour leave it off, the warm-up
    // tests turn it on.
    warm: 0,
    // The upload queue of `textures.upload` (F60), as the engine's default: idle until a test hands it textures.
    uploads: 1,
    // The phone check of the engine's default asks `matchMedia` once more: the tests of the scale turn it on.
    adaptiveScale: false,
    ...options.config
  };
  const state = createRendererState({ config });
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const frames: FrameRegistration[] = [];
  const pauses: Array<{ action: "push" | "pop"; reason: PauseReason }> = [];
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };
  const clock = { now: 0, paused: false, wakes: 0, pending: 0, listeners: 0 };
  const measures: MeasureListener[] = [];
  const charged: number[] = [];
  // The rate of a game without `adaptive`, as the real time state starts it.
  const rate: { now: Readonly<FrameRate>; drawn: number } = {
    now: createRateState({
      maxFps: 60,
      maxDeltaMs: 50,
      idleFps: 30,
      idleAfterMs: 2000,
      adaptive: false
    }).snapshot,
    drawn: 0
  };
  const flowState = { path: "home" };
  const systems: { timing: SystemTiming | undefined } = { timing: undefined };

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
    wake: () => {
      clock.wakes += 1;
    },
    wakes: () => clock.wakes,
    frameListeners: () => frames.length,
    step: vi.fn(),
    measure: (listener: MeasureListener): (() => void) => {
      measures.push(listener);

      return () => {
        const at = measures.indexOf(listener);

        if (at !== -1) measures.splice(at, 1);
      };
    },
    agentClock: () => undefined,
    chargeAgent: (ms: number) => {
      charged.push(ms);
    },
    rate: () => rate.now,
    setRate: vi.fn(),
    allowScale: () => rate.now,
    frameDrawn: () => {
      rate.drawn += 1;
    },
    frameProbed: vi.fn()
  } as unknown as TimeApi;
  const flowApi = {
    state: () => ({ mode: "live", path: flowState.path }),
    features: { all: () => [] },
    fx: { onHint: noRemover }
  } as unknown as FlowApi;

  const clockApi = {
    now: () => clock.now,
    pending: () => clock.pending,
    listeners: () => clock.listeners
  } as unknown as ClockApi;

  const lifecycleApi = {
    push: (reason: PauseReason) => pauses.push({ action: "push", reason }),
    pop: (reason: PauseReason) => pauses.push({ action: "pop", reason }),
    reasons: () => [],
    isPaused: () => false
  } as unknown as LifecycleApi;

  const worldTime = { now: 0 };
  const world = createWorld(timeApi, flowApi, log, systems, worldTime);
  const apis: Record<string, unknown> = {
    time: timeApi,
    lifecycle: lifecycleApi,
    world,
    clock: clockApi,
    flow: flowApi
  };
  // One reused record, as `time` hands its listeners: a frame of the mock allocates nothing.
  const quiet: FrameMeasure = {
    frame: 0,
    at: 0,
    gapMs: Number.NaN,
    capMs: 1000 / 60,
    rateMs: 1000 / 60,
    displayMs: Number.NaN,
    skipped: 0,
    startMs: 0,
    phaseMs: new Float32Array(6),
    workMs: 0,
    listenersMs: 0,
    idle: false,
    stepped: false
  };
  const measured: FrameMeasure = { ...quiet };
  const measureFrame = (record: Partial<FrameMeasure> = quiet): void => {
    Object.assign(measured, quiet);
    measured.frame = time.frame;
    Object.assign(measured, record);

    for (let index = 0; index < measures.length; index += 1) measures[index]?.(measured);
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
    hooks: createHandlers(ctx),
    modules,
    world,
    log,
    emitted,
    pixi,
    dom,
    frames,
    pauses,
    time: timeApi,
    setNow: (ms: number): void => {
      clock.now = ms;
    },
    setWorldNow: (ms: number): void => {
      worldTime.now = ms;
    },
    setElapsed: (ms: number): void => {
      time.elapsed = ms;
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
    stop: () => stopRenderer({ config, state }),
    measures,
    charged,
    drawnCount: () => rate.drawn,
    setRate: (next: Readonly<FrameRate>): void => {
      rate.now = next;
    },
    measureFrame,
    drawFrame: (record: Partial<FrameMeasure> = quiet): void => {
      time.frame += 1;

      for (const registration of frames) {
        if (registration.phase === "input") registration.callback(time);
      }
      for (const registration of frames) {
        if (registration.phase === "render") registration.callback(time);
      }
      measureFrame(record);
    },
    setPath: (path: string): void => {
      flowState.path = path;
    },
    setSystemTimes: (timing: SystemTiming | undefined): void => {
      systems.timing = timing;
    },
    setClockCounts: (pending: number, listeners: number): void => {
      clock.pending = pending;
      clock.listeners = listeners;
    }
  };
}
