/**
 * @file scenes plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API, lifecycle and switch run over a fake `flow`, a fake
 * `world` and a fake `assets`, so nothing loads, nothing is drawn and nothing needs a DOM.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as AssetsApi } from "../../../assets/types";
import type { FeatureDescription } from "../../../flow/features/types";
import type { EnterCallback, Api as FlowApi, NodeInfo, Stage } from "../../../flow/types";
import type { Api as TimeApi } from "../../../time/types";
import type { LayerSpec, Owner, Api as WorldApi } from "../../../world/types";
import { createScenesApi } from "../../api";
import { startScenes, stopScenes, withDeps } from "../../lifecycle";
import { createScenesState } from "../../state";
import type { KernelSlice, RunContext, ScenesApi, ScenesCtx, State } from "../../types";

/** One load the fake `assets` is holding back. */
export type HeldLoad = { bundle: string; resolve: () => void; reject: (error: unknown) => void };

/** What the fake `assets` recorded and how a test steers it. */
export type FakeAssets = {
  loaded: string[];
  /** While `gated` is true every load waits for `release` or `fail`. */
  control: { gated: boolean };
  held: HeldLoad[];
  release(): void;
  fail(error: unknown): void;
  api: AssetsApi;
};

/** What the fake `world` recorded. */
export type FakeWorld = {
  calls: string[];
  layers: LayerSpec[][];
  mounted: Array<{ names: readonly string[]; owner: Owner }>;
  unmounted: string[][];
  /** Set by a test: `mount` throws it once, the way an unknown projection does. */
  mountError: unknown;
  api: WorldApi;
};

/** What the fake `time` recorded. */
export type FakeTime = {
  /** How often the switch asked the loop to come back to the full frame rate. */
  wakes: number;
  api: TimeApi;
};

/** What the fake `flow` recorded and what it answers with. */
export type FakeFlow = {
  features: Array<{ name: string; description: FeatureDescription }>;
  enter: Array<{ stage: Stage; callback: EnterCallback }>;
  api: FlowApi;
};

/** Everything a unit test drives the plugin with. */
export type MockScenes = {
  ctx: KernelSlice;
  scenesCtx: ScenesCtx;
  state: State;
  api: ScenesApi;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  flow: FakeFlow;
  world: FakeWorld;
  assets: FakeAssets;
  time: FakeTime;
  start(): void;
  stop(): void;
  /** Calls the registered `onEnter("scene")` callback, the way the runner does. */
  enter(node: Partial<NodeInfo>, run?: Partial<RunContext>): Promise<void>;
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
 * Builds a full `NodeInfo` out of the few fields a test cares about.
 *
 * @param node - The fields the test set.
 * @returns The node info the runner would hand the callback.
 */
export function nodeOf(node: Partial<NodeInfo>): NodeInfo {
  return {
    path: "main/node",
    flow: "main",
    node: "node",
    rest: false,
    over: false,
    checkpoint: false,
    barrier: false,
    ...node
  };
}

/**
 * Creates the fake `assets`: one member, `load`, which resolves at once unless a test gates it.
 *
 * @returns The fake assets and its recordings.
 */
function createFakeAssets(): FakeAssets {
  const loaded: string[] = [];
  const control = { gated: false };
  const held: HeldLoad[] = [];

  const api = {
    load: async (bundle: string): Promise<void> => {
      loaded.push(bundle);

      if (control.gated) {
        await new Promise<void>((resolve, reject) => {
          held.push({ bundle, resolve, reject });
        });
      }
    },
    unload: () => undefined,
    isLoaded: () => true,
    texture: () => undefined,
    usage: () => ({ textureMb: 0, budgetMb: 0, bundles: [] })
  } as unknown as AssetsApi;

  return {
    loaded,
    control,
    held,
    release: (): void => {
      for (const entry of held.splice(0)) entry.resolve();
    },
    fail: (error: unknown): void => {
      for (const entry of held.splice(0)) entry.reject(error);
    },
    api
  };
}

/**
 * Creates the fake `world`: the three `projection` members the switch calls, each recording the
 * call and its order.
 *
 * @returns The fake world and its recordings.
 */
function createFakeWorld(): FakeWorld {
  const fake: FakeWorld = {
    calls: [],
    layers: [],
    mounted: [],
    unmounted: [],
    mountError: undefined,
    api: undefined as unknown as WorldApi
  };

  fake.api = {
    projection: {
      setLayers: (list: ReadonlyArray<LayerSpec>): void => {
        fake.calls.push("setLayers");
        fake.layers.push([...list]);
      },
      unmount: (names: readonly string[]): void => {
        fake.calls.push("unmount");
        fake.unmounted.push([...names]);
      },
      mount: (names: readonly string[], owner: Owner): void => {
        fake.calls.push("mount");

        if (fake.mountError !== undefined) {
          const error = fake.mountError;

          fake.mountError = undefined;
          throw error;
        }

        fake.mounted.push({ names: [...names], owner });
      }
    }
  } as unknown as WorldApi;

  return fake;
}

/**
 * Creates the fake `time`: the one member `scenes` calls, counting the wakes.
 *
 * @returns The fake time and its recording.
 */
function createFakeTime(): FakeTime {
  const fake: FakeTime = { wakes: 0, api: undefined as unknown as TimeApi };

  fake.api = {
    wake: (): void => {
      fake.wakes += 1;
    }
  } as unknown as TimeApi;

  return fake;
}

/**
 * Creates the fake `flow`: the two members `scenes` calls, each backed by a field a test writes.
 *
 * @returns The fake flow and its recordings.
 */
function createFakeFlow(): FakeFlow {
  const fake: FakeFlow = {
    features: [],
    enter: [],
    api: undefined as unknown as FlowApi
  };

  fake.api = {
    onEnter: (stage: Stage, callback: EnterCallback): (() => void) => {
      const registration = { stage, callback };

      fake.enter.push(registration);

      return () => {
        const at = fake.enter.indexOf(registration);

        if (at !== -1) fake.enter.splice(at, 1);
      };
    },
    features: { all: () => fake.features }
  } as unknown as FlowApi;

  return fake;
}

/**
 * Creates the mock plugin: the real state, the real API and the real lifecycle over the fakes.
 *
 * @returns The context, the API, the fakes and the lifecycle steps.
 */
export function createMockScenes(): MockScenes {
  const state = createScenesState();
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const flow = createFakeFlow();
  const world = createFakeWorld();
  const assets = createFakeAssets();
  const time = createFakeTime();
  const apis: Record<string, unknown> = {
    flow: flow.api,
    world: world.api,
    assets: assets.api,
    time: time.api
  };

  const ctx: KernelSlice = {
    config: {},
    state,
    emit: (name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    },
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  const mock: MockScenes = {
    ctx,
    scenesCtx: withDeps(ctx),
    state,
    api: createScenesApi(ctx),
    log,
    emitted,
    flow,
    world,
    assets,
    time,
    start: (): void => startScenes(ctx),
    stop: (): void => stopScenes({ state }),
    enter: async (node: Partial<NodeInfo>, run: Partial<RunContext> = {}): Promise<void> => {
      const callback = flow.enter[0]?.callback;

      if (callback === undefined) throw new Error("no onEnter callback was registered");

      await callback(nodeOf(node), {
        mode: run.mode ?? "live",
        signal: run.signal ?? new AbortController().signal
      });
    }
  };

  return mock;
}
