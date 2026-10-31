/**
 * @file effects plugin — the mock kernel context of the unit tests. Not a test file: the unit
 * project only collects `*.test.ts`. The real `ecs` of `world` runs under a fake `time`, `model`
 * and `flow`; `renderer` and `assets` are fakes that answer from fields a test sets, and Pixi is the
 * fake module of `fake-effects-pixi.ts`; `anim` answers its reduced-motion switch from a field. The real `effects` lifecycle, systems and API run over
 * them, so every case runs in plain Bun.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { AnimApi } from "../../../anim/types";
import type { Api as AssetsApi } from "../../../assets/types";
import type { Api as ClockApi } from "../../../clock/types";
import type { EnterCallback, FeatureDescription, Api as FlowApi, Stage } from "../../../flow/types";
import type { Json, Api as ModelApi, Snapshot } from "../../../model/types";
import type { FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import type {
  FilterSlot,
  FilterSlotQuad,
  PixiFilter,
  Api as RendererApi,
  RendererKind
} from "../../../renderer/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../../time/types";
import { createWorldApi } from "../../../world/api";
import { connectWorld } from "../../../world/lifecycle";
import { createWorldState } from "../../../world/state";
import type {
  AnyComponentValue,
  Entity,
  Api as WorldApi,
  KernelSlice as WorldKernelSlice
} from "../../../world/types";
import { createEffectsApi } from "../../api";
import { startEffects, stopEffects, withDeps } from "../../lifecycle";
import { createEffectsState } from "../../state";
import type { Config, EffectsApi, EffectsCtx, KernelSlice, State } from "../../types";
import {
  createFakeDevice,
  createFakeEffectsPixi,
  createFakeGl,
  type FakeDevice,
  type FakeEffectsPixi,
  type FakeGl
} from "../fake-effects-pixi";

const PHASE_ORDER: readonly Phase[] = ["input", "animate", "layout", "sync", "signals", "render"];

/** The remover of a listener nothing ever calls. */
const noRemover = (): void => undefined;

/** One `time.onFrame` registration. */
type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** What the fake renderer answers and records. */
export type FakeRendererState = {
  /** `host.ready()`. */
  ready: boolean;
  /** `sync.renderPasses()`. */
  passes: number;
  /** `host.kind()`: `"webgpu"` by default. */
  kind: RendererKind;
  /**
   * `host.device()`: `undefined` by default, so every shader check answers ok at the first frame; a test of the WGSL
   * check sets `gpu.device`.
   */
  device: GPUDevice | undefined;
  /** `host.resolution()`: 1 by default. */
  resolution: number;
  /** `host.gl()`: `undefined` by default, as on WebGPU. */
  gl: WebGL2RenderingContext | undefined;
  /** Every `sync.filters.set` call, in order. */
  sets: Array<{ entity: Entity; slots: readonly FilterSlot[] }>;
  /** Every `sync.filters.area` call, in order. */
  areas: Array<{ entity: Entity; area: readonly [number, number, number, number] | undefined }>;
  /** Every filter handed to `sync.filters.warm`, in order. */
  warms: PixiFilter[];
  /** The quad handed with each of `warms`, at the same index; `undefined` for a filter handed alone. */
  warmQuads: Array<FilterSlotQuad | undefined>;
  /**
   * What `sync.filters.warm` answers, at once: `false` by default (a renderer with nothing to warm, `warm: 0`);
   * `"later"` keeps every answer for `answerWarm`.
   */
  warmAnswer: boolean | "later";
  /** Answers every warm still waiting. */
  answerWarm(warmed: boolean): void;
  /** Entities `sync.displayOf` answers an object for. */
  displays: Set<Entity>;
  /** `viewport.size()` width and height, reference units. */
  viewport: { width: number; height: number };
};

/** The mock effects world: the plugin, the fakes behind it and a frame driver. */
export type MockEffects = {
  ctx: KernelSlice;
  ectx: EffectsCtx;
  state: State;
  api: EffectsApi;
  world: WorldApi;
  /** The kernel context of `world`: a perf fixture builds its own phase runner over it. */
  worldCtx: WorldKernelSlice;
  log: Log.LogApi;
  pixi: FakeEffectsPixi;
  gpu: FakeDevice;
  /** The WebGL2 context a test hands `host.gl()` to drive the GLSL check. */
  gl: FakeGl;
  renderer: FakeRendererState;
  /** The textures `assets.texture(key)` answers. */
  textures: Map<string, FakeTexture>;
  features: Array<{ name: string; description: FeatureDescription }>;
  /** The flow mode the world reads; `"fast"` makes the world fast. */
  flow: { mode: "live" | "fast" };
  /** Every `flow.onEnter` registration still in force, in order. */
  enters: Array<{ stage: Stage; callback: EnterCallback }>;
  /** What `anim.reducedMotion()` answers. */
  anim: { reducedMotion: boolean };
  time: Time;
  /** Runs `connectWorld`, then `startEffects`, as the kernel would. */
  start(): void;
  /** Runs `stopEffects` with the state, as `onStop` would. */
  stop(): void;
  /** Runs one frame: every recorded callback, in phase order and registration order. */
  frame(deltaMs?: number): void;
  /** Spawns an entity owned by the test. */
  spawn(components: readonly AnyComponentValue[]): Entity;
};

/**
 * Creates the engine log as spies.
 *
 * @returns A log whose every method is a spy.
 */
export function createMockLog(): Log.LogApi {
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
 * Creates the mock effects world. The renderer is ready by default.
 *
 * @param options - Config overrides and the renderer's start.
 * @param options.config - Overrides of the effects config.
 * @param options.ready - Whether `host.ready()` answers true.
 * @returns The plugin, the fakes and the frame driver.
 */
export function createMockEffects(
  options: { config?: Partial<Config>; ready?: boolean } = {}
): MockEffects {
  const config: Config = {
    maxParticles: 3000,
    maxPasses: 24,
    phone: false,
    blur: { quality: 2, phoneResolution: 0.5 },
    ...options.config
  };
  const state = createEffectsState();
  const log = createMockLog();
  const pixi = createFakeEffectsPixi();
  const gpu = createFakeDevice();
  const gl = createFakeGl();
  const features: Array<{ name: string; description: FeatureDescription }> = [];
  const frames: FrameRegistration[] = [];
  const textures = new Map<string, FakeTexture>();
  const flowMode: { mode: "live" | "fast" } = { mode: "live" };
  const enters: Array<{ stage: Stage; callback: EnterCallback }> = [];
  const animState = { reducedMotion: false };
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };
  const model: { player: Json; session: Json } = { player: {}, session: {} };
  const warmWaiting: Array<(warmed: boolean) => void> = [];
  const renderer: FakeRendererState = {
    ready: options.ready ?? true,
    passes: 1,
    kind: "webgpu",
    device: undefined,
    resolution: 1,
    gl: undefined,
    sets: [],
    areas: [],
    warms: [],
    warmQuads: [],
    warmAnswer: false,
    answerWarm: (warmed: boolean): void => {
      for (const resolve of warmWaiting.splice(0)) resolve(warmed);
    },
    displays: new Set(),
    viewport: { width: 1080, height: 1920 }
  };

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
    wake: vi.fn(),
    step: vi.fn(),
    // The world asks for the page clock in an agent build; this fake hands none out.
    agentClock: () => undefined
  } as unknown as TimeApi;

  const snapshot = (): Snapshot => ({
    player: model.player,
    session: model.session,
    rng: { seed: 1, streams: {} }
  });

  const modelApi = { store: { snapshot }, rng: { peek: vi.fn() } } as unknown as ModelApi;

  const flowApi = {
    state: () => ({ mode: flowMode.mode }),
    features: { all: () => features },
    fx: { onHint: (): (() => void) => noRemover },
    onEnter: (stage: Stage, callback: EnterCallback): (() => void) => {
      const registration = { stage, callback };

      enters.push(registration);

      return () => {
        const at = enters.indexOf(registration);

        if (at !== -1) enters.splice(at, 1);
      };
    }
  } as unknown as FlowApi;

  const worldConfig = { settleMs: 350, reconciledEvent: false };
  const worldState = createWorldState({ config: worldConfig });
  // World writes the frame's moment into its `Now` resource (spec 15): a still clock is enough here.
  const clockApi = { now: () => 0 } as unknown as ClockApi;
  const worldApis: Record<string, unknown> = {
    time: timeApi,
    model: modelApi,
    flow: flowApi,
    clock: clockApi
  };
  const worldCtx: WorldKernelSlice = {
    config: worldConfig,
    state: worldState,
    emit: (): void => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => worldApis[plugin.name]) as unknown as Require
  };
  const world = createWorldApi(worldCtx);

  const rendererApi = {
    host: {
      ready: () => renderer.ready,
      pixi: () => (renderer.ready ? pixi.module : undefined),
      kind: () => renderer.kind,
      device: () => renderer.device,
      gl: () => renderer.gl,
      resolution: () => renderer.resolution
    },
    sync: {
      filters: {
        set: (entity: Entity, slots: readonly FilterSlot[]): void => {
          renderer.sets.push({ entity, slots });
        },
        area: (
          entity: Entity,
          area: readonly [number, number, number, number] | undefined
        ): void => {
          renderer.areas.push({ entity, area });
        },
        warm: (filter: PixiFilter, quad?: FilterSlotQuad): Promise<boolean> => {
          renderer.warms.push(filter);
          renderer.warmQuads.push(quad);

          if (renderer.warmAnswer !== "later") return Promise.resolve(renderer.warmAnswer);

          return new Promise(resolve => {
            warmWaiting.push(resolve);
          });
        }
      },
      renderPasses: (): number => renderer.passes,
      displayOf: (entity: Entity): unknown => (renderer.displays.has(entity) ? {} : undefined)
    },
    viewport: {
      size: () => ({ ...renderer.viewport, scale: 1, orientation: "portrait" })
    },
    monitor: { event: vi.fn() },
    invalidate: vi.fn(),
    stats: (): never => {
      throw new Error("effects reads renderer.sync.renderPasses(), never renderer.stats()");
    }
  } as unknown as RendererApi;

  const assetsApi = {
    texture: (key: string) => textures.get(key)
  } as unknown as AssetsApi;

  const animApi = { reducedMotion: () => animState.reducedMotion } as unknown as AnimApi;

  const apis: Record<string, unknown> = {
    ...worldApis,
    world,
    renderer: rendererApi,
    assets: assetsApi,
    anim: animApi
  };
  const ctx: KernelSlice = {
    config,
    state,
    emit: (): void => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  return {
    ctx,
    ectx: withDeps(ctx),
    state,
    api: createEffectsApi(ctx),
    world,
    worldCtx,
    log,
    pixi,
    gpu,
    gl,
    renderer,
    textures,
    features,
    flow: flowMode,
    enters,
    anim: animState,
    time,
    start: (): void => {
      connectWorld(worldCtx);
      startEffects(ctx);
    },
    stop: (): void => {
      stopEffects(state);
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
    },
    spawn: (components: readonly AnyComponentValue[]): Entity =>
      world.ecs.spawn({ kind: "plugin", name: "test" }, components)
  };
}
