/**
 * @file scenes plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API, lifecycle and switch run over a fake `flow`, a fake
 * `world`, a fake `assets`, a fake `time`, a fake `model` and a fake `renderer`, so nothing loads,
 * nothing is drawn and nothing needs a DOM. The renderer draws nothing by default
 * (`host.ready()` is false), so a switch takes the one-block path unless a test turns it on.
 */
import type { Log } from "@moku-labs/common/browser";
import { type Mock, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as AssetsApi } from "../../../assets/types";
import type { FeatureDescription } from "../../../flow/features/types";
import type { EnterCallback, Api as FlowApi, NodeInfo, Stage } from "../../../flow/types";
import type { Json, Api as ModelApi } from "../../../model/types";
import type { LeaveLook } from "../../../renderer/types";
import type { FrameCallback, Phase, Api as TimeApi } from "../../../time/types";
import type { LayerSpec, Owner, Api as WorldApi, WorldMode } from "../../../world/types";
import { createScenesApi } from "../../api";
import { checkConfig, startScenes, stopScenes, withDeps } from "../../lifecycle";
import { createScenesState } from "../../state";
import type { Config, KernelSlice, RunContext, ScenesApi, ScenesCtx, State } from "../../types";

/** The first view entity the fake `world` answers for a projection of `viewLayers`. */
const VIEW_ENTITY = 9000;

/** One load the fake `assets` is holding back. */
export type HeldLoad = { bundle: string; resolve: () => void; reject: (error: unknown) => void };

/** What the fake `assets` recorded and how a test steers it. */
export type FakeAssets = {
  loaded: string[];
  /** While `gated` is true every load waits for `release` or `fail`. */
  control: { gated: boolean };
  held: HeldLoad[];
  /** Every list `sceneBundles` was called with, in order. */
  named: string[][];
  release(): void;
  /** Releases the held loads of one bundle and keeps the others held. */
  releaseBundle(bundle: string): void;
  fail(error: unknown): void;
  /** Every bundle `warm` was called with, and how a test steers it: `gate` is what each warm returns. */
  warm: { calls: string[]; gate: Promise<void> };
  /** Every list `sceneComing` was called with, in order. */
  coming: string[][];
  api: AssetsApi;
};

/** The fake `model`: `store.snapshot()` returns the frozen trees a test sets. */
export type FakeModel = {
  /** Replaces the committed trees; the next snapshot is a new frozen object. */
  set(player: Json, session: Json): void;
  api: ModelApi;
};

/** One call of `projection.build`, as the fake `world` recorded it. */
export type BuildCall = {
  names: readonly string[];
  owner: Owner;
  layers: readonly LayerSpec[];
  budgetMs: number;
};

/** What the fake `world` recorded. */
export type FakeWorld = {
  calls: string[];
  layers: LayerSpec[][];
  mounted: Array<{ names: readonly string[]; owner: Owner }>;
  unmounted: string[][];
  /** Set by a test: `mount` throws it once, the way an unknown projection does. */
  mountError: unknown;
  /** Set by a test: `setLayers` throws it once, the way a bad layer list does. */
  setLayersError: unknown;
  /** Set by a test: `unmount` throws it once, the way a throwing removal hook does. */
  unmountError: unknown;
  /** Every scene `ecs.setScene` was told, in order. */
  scenes: string[];
  /**
   * Set by a test: the layer the views of a projection draw in. A projection named here answers one view entity in
   * `entitiesOf` while it is mounted (`live`), whose `Layer` `ecs.get` answers; any other answers none.
   */
  viewLayers: Record<string, string>;
  /** The projections mounted now: a mount adds its names, an unmount takes them out; a test may add one. */
  live: Set<string>;
  /** What `ecs.mode()` answers: `"fast"` while the flow walks fast. */
  mode: WorldMode;
  /**
   * The build of the next scene, steered by a test: `answer` is what `build` answers (false is a
   * projection mounted under other layer rules), `error` is thrown once by `build`, the way a
   * throwing `view` is, `done` is what `built()` answers while a build runs, `commitError` is
   * thrown once by `commit`. `running` tells whether a build runs; `build` throws while one runs, as
   * the world does.
   */
  building: {
    answer: boolean;
    error: unknown;
    done: boolean;
    commitError: unknown;
    running: boolean;
    calls: BuildCall[];
  };
  api: WorldApi;
};

/** What the fake `time` recorded. */
export type FakeTime = {
  /** How often the switch asked the loop to come back to the full frame rate. */
  wakes: number;
  /** How often the switch told the adaptive frame rate that a new scene stands. */
  scenes: number;
  /** The frame callbacks registered now, by phase. */
  callbacks: Record<Phase, FrameCallback[]>;
  /** The page clock of an agent build, ms; `undefined` is a build without the flag. */
  clock: { now: number } | undefined;
  /** What `rate().fps` answers: the frame rate the loop runs at, 60 unless a test moves it. */
  fps: number;
  /** Runs one frame: every registered callback, phase by phase, as `time.step` does. */
  frame(): void;
  api: TimeApi;
};

/**
 * The fake `renderer`: its host's `ready`, a spy answering false, its performance log's `event`, a spy, and the
 * picture of a scene being left, three spies that record the scene current when each was called.
 */
export type FakeRenderer = {
  host: { ready: Mock<() => boolean> };
  monitor: { event: Mock<(name: string, detail?: unknown) => void> };
  sync: {
    leave: {
      show: Mock<(look: LeaveLook) => void>;
      land: Mock<() => void>;
      drop: Mock<() => void>;
    };
  };
  /** Every call of `sync.leave`, in order, with the scene current then. */
  leaves: Array<{ call: "show" | "land" | "drop"; current: string | undefined }>;
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
  model: FakeModel;
  renderer: FakeRenderer;
  /**
   * Every call the switch made into its fakes, in order, as `world:setLayers`, `assets:sceneBundles`,
   * `time:wake`, `emit:scenes:changed` or `monitor:scene`: the order of the swap.
   */
  journal: string[];
  /** Runs `onInit`: the config check. */
  init(): void;
  start(): void;
  stop(): void;
  /**
   * Enters a node the way the runner does: the registered `onEnter` callbacks of `begin`, then those of `scene`, with
   * one signal. A `begin` callback never waits (flow's rule), so they are called in a row and the `scene` stage starts
   * in the same turn. Unlike the runner, the `scene` stage runs also after an abort: the plugin's own handling of an
   * aborted signal is what these tests see. The `load` stage belongs to `assets`: a test that holds it calls `stage`
   * for each side of it.
   */
  enter(node: Partial<NodeInfo>, run?: Partial<RunContext>): Promise<void>;
  /** Calls the registered `onEnter` callbacks of one stage, in registration order, each awaited. */
  stage(stage: Stage, node: Partial<NodeInfo>, run?: Partial<RunContext>): Promise<void>;
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
 * Creates the fake `assets`: `load`, which resolves at once unless a test gates it, and `warm`, which records the bundle and returns `warm.gate`.
 *
 * @param journal - The order of every call into the fakes.
 * @returns The fake assets and its recordings.
 */
function createFakeAssets(journal: string[]): FakeAssets {
  const loaded: string[] = [];
  const control = { gated: false };
  const held: HeldLoad[] = [];
  const named: string[][] = [];
  const coming: string[][] = [];
  const warm = { calls: [] as string[], gate: Promise.resolve() };

  const api = {
    load: async (bundle: string): Promise<void> => {
      loaded.push(bundle);

      if (control.gated) {
        await new Promise<void>((resolve, reject) => {
          held.push({ bundle, resolve, reject });
        });
      }
    },
    // Nothing is drawn here: the warm of a loaded bundle answers at once unless a test sets `gate`.
    warm: (bundle: string): Promise<void> => {
      warm.calls.push(bundle);

      return warm.gate;
    },
    unload: () => undefined,
    isLoaded: () => true,
    texture: () => undefined,
    usage: () => ({ textureMb: 0, budgetMb: 0, bundles: [] }),
    sceneBundles: (list: readonly string[]): void => {
      journal.push("assets:sceneBundles");
      named.push([...list]);
    },
    sceneComing: (list: readonly string[]): void => {
      journal.push("assets:sceneComing");
      coming.push([...list]);
    }
  } as unknown as AssetsApi;

  return {
    loaded,
    control,
    held,
    named,
    release: (): void => {
      for (const entry of held.splice(0)) entry.resolve();
    },
    releaseBundle: (bundle: string): void => {
      for (const entry of held.filter(load => load.bundle === bundle)) {
        held.splice(held.indexOf(entry), 1);
        entry.resolve();
      }
    },
    fail: (error: unknown): void => {
      for (const entry of held.splice(0)) entry.reject(error);
    },
    warm,
    coming,
    api
  };
}

/**
 * Takes the error a test set on a field once, so the next call goes through.
 *
 * @param holder - The object that holds the error.
 * @param field - The field the error is in.
 * @throws {Error} The error the field held.
 */
function throwOnce<Field extends string>(holder: Record<Field, unknown>, field: Field): void {
  const error = holder[field];

  if (error === undefined) return;

  holder[field] = undefined;
  throw error;
}

/**
 * Creates the fake `world`: the `projection` members the switch calls, each recording the call
 * and its order, the build members steered by `building`, `ecs.setScene`, recording the scenes it
 * was told, and `ecs.mode`, answering `mode`.
 *
 * @param journal - The order of every call into the fakes.
 * @returns The fake world and its recordings.
 */
function createFakeWorld(journal: string[]): FakeWorld {
  const fake: FakeWorld = {
    calls: [],
    layers: [],
    mounted: [],
    unmounted: [],
    mountError: undefined,
    setLayersError: undefined,
    unmountError: undefined,
    scenes: [],
    viewLayers: {},
    live: new Set(),
    mode: "live",
    building: {
      answer: true,
      error: undefined,
      done: false,
      commitError: undefined,
      running: false,
      calls: []
    },
    api: undefined as unknown as WorldApi
  };
  const record = (call: string): void => {
    fake.calls.push(call);
    journal.push(`world:${call}`);
  };

  fake.api = {
    ecs: {
      setScene: (scene: string): void => {
        journal.push("world:setScene");
        fake.scenes.push(scene);
      },
      mode: (): WorldMode => fake.mode,
      get: (entity: number): { name: string } | undefined => {
        const name = Object.keys(fake.viewLayers)[entity - VIEW_ENTITY];
        const layer = name === undefined ? undefined : fake.viewLayers[name];

        return layer === undefined ? undefined : { name: layer };
      }
    },
    projection: {
      setLayers: (list: ReadonlyArray<LayerSpec>): void => {
        record("setLayers");
        throwOnce(fake, "setLayersError");
        fake.layers.push([...list]);
      },
      unmount: (names: readonly string[]): void => {
        record("unmount");
        throwOnce(fake, "unmountError");
        fake.unmounted.push([...names]);
        for (const name of names) fake.live.delete(name);
      },
      mount: (names: readonly string[], owner: Owner): void => {
        record("mount");
        throwOnce(fake, "mountError");
        fake.mounted.push({ names: [...names], owner });
        for (const name of names) fake.live.add(name);
      },
      entitiesOf: (name: string): readonly number[] => {
        const at = Object.keys(fake.viewLayers).indexOf(name);

        return at === -1 || !fake.live.has(name) ? [] : [VIEW_ENTITY + at];
      },
      build: (
        names: readonly string[],
        owner: Owner,
        layers: ReadonlyArray<LayerSpec>,
        budgetMs: number
      ): boolean => {
        record("build");

        if (fake.building.running) throw new Error("[game] A scene is already being built.");

        fake.building.calls.push({ names: [...names], owner, layers: [...layers], budgetMs });
        throwOnce(fake.building, "error");
        fake.building.running = fake.building.answer;

        return fake.building.answer;
      },
      built: (): boolean => fake.building.running && fake.building.done,
      commit: (): void => {
        record("commit");
        throwOnce(fake.building, "commitError");
        fake.building.running = false;
      },
      discard: (): void => {
        record("discard");
        fake.building.running = false;
      }
    }
  } as unknown as WorldApi;

  return fake;
}

/**
 * Creates the fake `time`: the members `scenes` calls, counting the wakes and the new scenes,
 * keeping the frame callbacks for `frame()`, and answering the page clock of `clock` and the
 * frame rate of `fps`.
 *
 * @param journal - The order of every call into the fakes.
 * @returns The fake time and its recording.
 */
function createFakeTime(journal: string[]): FakeTime {
  const fake: FakeTime = {
    wakes: 0,
    scenes: 0,
    callbacks: { input: [], animate: [], layout: [], sync: [], signals: [], render: [] },
    clock: undefined,
    fps: 60,
    frame: (): void => {
      for (const callbacks of Object.values(fake.callbacks)) {
        // eslint-disable-next-line unicorn/no-useless-spread -- a callback that removes itself does not skip the next one
        for (const callback of [...callbacks]) {
          callback({ delta: 16, elapsed: 16, scale: 1, frame: 1, idle: false });
        }
      }
    },
    api: undefined as unknown as TimeApi
  };

  fake.api = {
    wake: (): void => {
      journal.push("time:wake");
      fake.wakes += 1;
    },
    sceneChanged: (): void => {
      journal.push("time:sceneChanged");
      fake.scenes += 1;
    },
    onFrame: (phase: Phase, callback: FrameCallback): (() => void) => {
      fake.callbacks[phase].push(callback);

      return () => {
        const at = fake.callbacks[phase].indexOf(callback);

        if (at !== -1) fake.callbacks[phase].splice(at, 1);
      };
    },
    agentClock: (): (() => number) | undefined => {
      const clock = fake.clock;

      return clock === undefined ? undefined : () => clock.now;
    },
    rate: (): { fps: number } => ({ fps: fake.fps })
  } as unknown as TimeApi;

  return fake;
}

/**
 * Creates the fake `model`: `store.snapshot()` returns one frozen `{ player, session, rng }`
 * until a test sets new trees, the way the real store keeps one snapshot per commit.
 *
 * @returns The fake model and its setter.
 */
function createFakeModel(): FakeModel {
  const committed: { snapshot: ReturnType<ModelApi["store"]["snapshot"]> } = {
    snapshot: Object.freeze({
      player: Object.freeze({}),
      session: Object.freeze({}),
      rng: Object.freeze({ seed: 1, streams: {} })
    })
  };

  return {
    set: (player: Json, session: Json): void => {
      // Frozen in place, the way the store freezes a committed tree.
      Object.freeze(player);
      Object.freeze(session);
      committed.snapshot = Object.freeze({ player, session, rng: committed.snapshot.rng });
    },
    api: { store: { snapshot: () => committed.snapshot } } as unknown as ModelApi
  };
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
 * Fills in the mode and the signal a test left out: live, and a signal nobody aborts.
 *
 * @param run - What the test gave.
 * @returns What the runner hands a callback.
 */
function runOf(run: Partial<RunContext>): RunContext {
  return { mode: run.mode ?? "live", signal: run.signal ?? new AbortController().signal };
}

/**
 * Calls the callbacks a fake `flow` holds for one stage, the way the runner does.
 *
 * @param flow - The fake flow.
 * @param stage - The stage.
 * @param node - The fields of the node the test set.
 * @param run - The mode and the signal.
 */
async function runStage(
  flow: FakeFlow,
  stage: Stage,
  node: Partial<NodeInfo>,
  run: RunContext
): Promise<void> {
  const callbacks = flow.enter.filter(entry => entry.stage === stage);

  if (stage === "scene" && callbacks.length === 0) {
    throw new Error("no onEnter callback was registered");
  }

  for (const { callback } of callbacks) await callback(nodeOf(node), run);
}

/**
 * Calls the `begin` callbacks a fake `flow` holds, in a row: none of them waits.
 *
 * @param flow - The fake flow.
 * @param node - The fields of the node the test set.
 * @param run - The mode and the signal.
 */
function runBegin(flow: FakeFlow, node: Partial<NodeInfo>, run: RunContext): void {
  for (const { stage, callback } of flow.enter) {
    if (stage === "begin") callback(nodeOf(node), run);
  }
}

/**
 * Creates the mock plugin: the real state, the real API and the real lifecycle over the fakes.
 *
 * @param config - The config the kernel resolved; `{ buildMs: "auto" }`, the default, when left out.
 * @returns The context, the API, the fakes and the lifecycle steps.
 */
export function createMockScenes(config?: Config): MockScenes {
  const state = createScenesState();
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const journal: string[] = [];
  const flow = createFakeFlow();
  const world = createFakeWorld(journal);
  const assets = createFakeAssets(journal);
  const time = createFakeTime(journal);
  const model = createFakeModel();
  const leaves: FakeRenderer["leaves"] = [];
  const renderer: FakeRenderer = {
    host: { ready: vi.fn(() => false) },
    monitor: {
      event: vi.fn((name: string) => {
        journal.push(`monitor:${name}`);
      })
    },
    sync: {
      leave: {
        show: vi.fn(() => {
          leaves.push({ call: "show", current: state.current });
        }),
        land: vi.fn(() => {
          leaves.push({ call: "land", current: state.current });
        }),
        drop: vi.fn(() => {
          leaves.push({ call: "drop", current: state.current });
        })
      }
    },
    leaves
  };
  const apis: Record<string, unknown> = {
    flow: flow.api,
    world: world.api,
    assets: assets.api,
    time: time.api,
    model: model.api,
    renderer
  };

  const ctx: KernelSlice = {
    config: config ?? { buildMs: "auto" },
    state,
    emit: (name: string, payload: unknown): void => {
      journal.push(`emit:${name}`);
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
    model,
    renderer,
    journal,
    init: (): void => checkConfig(ctx.config),
    start: (): void => startScenes(ctx),
    stop: (): void => stopScenes({ state }),
    enter: (node: Partial<NodeInfo>, run: Partial<RunContext> = {}): Promise<void> => {
      const full = runOf(run);

      runBegin(flow, node, full);

      return runStage(flow, "scene", node, full);
    },
    stage: (stage: Stage, node: Partial<NodeInfo>, run: Partial<RunContext> = {}): Promise<void> =>
      runStage(flow, stage, node, runOf(run))
  };

  return mock;
}
