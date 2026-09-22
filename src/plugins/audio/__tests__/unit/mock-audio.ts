/**
 * @file audio plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API, handlers and lifecycle run over a fake `flow`, a fake
 * `assets`, a fake `model` and the fake audio context, so nothing needs a browser.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as AssetsApi } from "../../../assets/types";
import type { Descriptor, Api as FlowApi, FxHandler } from "../../../flow/types";
import type { Json, Api as ModelApi } from "../../../model/types";
import { createAudioApi } from "../../api";
import { createHandlers } from "../../handlers";
import { startAudio, stopAudio, withDeps } from "../../lifecycle";
import { createAudioState } from "../../state";
import type { AudioApi, AudioCtx, Config, KernelSlice, State } from "../../types";
import { bytesOf, type FakeContext } from "../fake-audio-context";

/** One registered fx handler. */
export type Registered = { kind: string; run: FxHandler; runInFast: boolean };

/** The fake `flow`: the one member `audio` calls, plus what it registered. */
export type FakeFlow = { registered: Registered[]; removed: string[]; api: FlowApi };

/** The fake `assets`: `audio(key)` answers bytes whose text is the key itself. */
export type FakeAssets = { asked: string[]; missing: Set<string>; api: AssetsApi };

/** The fake `model`: one committed player a test writes. */
export type FakeModel = { player: Json; api: ModelApi };

/** Everything a unit test drives the plugin with. */
export type MockAudio = {
  ctx: KernelSlice;
  audio: AudioCtx;
  state: State;
  api: AudioApi;
  log: Log.LogApi;
  context: FakeContext | undefined;
  flow: FakeFlow;
  assets: FakeAssets;
  model: FakeModel;
  hooks: ReturnType<typeof createHandlers>;
  start(): void;
  stop(): Promise<void>;
  /** Calls a registered fx handler the way `flow` does. */
  fx(kind: string, descriptor: Descriptor): Promise<unknown>;
  /** The `[value, time]` pairs scheduled on one bus gain, in creation order master, music, sfx. */
  ramps(index: number): Array<[number, number]>;
};

/** Creates the engine log as spies. */
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

/** Creates the fake `flow`: `fx.handle` records the registration and hands back its remover. */
function createFakeFlow(): FakeFlow {
  const fake: FakeFlow = {
    registered: [],
    removed: [],
    api: undefined as unknown as FlowApi
  };

  fake.api = {
    fx: {
      handle: (kind: string, run: FxHandler, options?: { runInFast?: boolean }): (() => void) => {
        const entry: Registered = { kind, run, runInFast: options?.runInFast ?? false };

        fake.registered.push(entry);

        return () => {
          const at = fake.registered.indexOf(entry);

          if (at !== -1) fake.registered.splice(at, 1);

          fake.removed.push(kind);
        };
      }
    }
  } as unknown as FlowApi;

  return fake;
}

/** Creates the fake `assets`: every key has bytes whose text is the key, unless it is `missing`. */
function createFakeAssets(): FakeAssets {
  const fake: FakeAssets = {
    asked: [],
    missing: new Set<string>(),
    api: undefined as unknown as AssetsApi
  };

  fake.api = {
    audio: (key: string): ArrayBuffer | undefined => {
      fake.asked.push(key);

      return fake.missing.has(key) ? undefined : bytesOf(key);
    }
  } as unknown as AssetsApi;

  return fake;
}

/** Creates the fake `model`: the committed player a test writes before it fires the hook. */
function createFakeModel(): FakeModel {
  const fake: FakeModel = { player: {}, api: undefined as unknown as ModelApi };

  fake.api = {
    store: { snapshot: () => ({ player: fake.player, session: {}, rng: { seed: 1, streams: {} } }) }
  } as unknown as ModelApi;

  return fake;
}

/** The six config defaults, as `index.ts` declares them. */
function defaultConfig(): Config {
  return {
    buses: { master: 1, music: 0.6, sfx: 1 },
    musicFadeMs: 600,
    volumes: undefined,
    context: undefined
  };
}

/**
 * Creates the mock plugin: the real state, API, handlers and lifecycle over the fakes. Without
 * `headless` the plugin gets the fake context through the same `config.context` seam a test uses.
 */
export function createMockAudio(
  options: { config?: Partial<Config>; context?: FakeContext } = {}
): MockAudio {
  const context = options.context;
  const config: Config = {
    ...defaultConfig(),
    ...(context === undefined ? {} : { context: () => context }),
    ...options.config
  };
  const state = createAudioState({ config });
  const log = createMockLog();
  const flow = createFakeFlow();
  const assets = createFakeAssets();
  const model = createFakeModel();
  const apis: Record<string, unknown> = { flow: flow.api, assets: assets.api, model: model.api };

  const ctx: KernelSlice = {
    config,
    state,
    emit: (() => undefined) as unknown as KernelSlice["emit"],
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  return {
    ctx,
    audio: withDeps(ctx),
    state,
    api: createAudioApi(ctx),
    log,
    context,
    flow,
    assets,
    model,
    hooks: createHandlers(ctx),
    start: (): void => startAudio(ctx),
    stop: (): Promise<void> => stopAudio(state),
    fx: (kind: string, descriptor: Descriptor): Promise<unknown> => {
      const entry = flow.registered.find(registration => registration.kind === kind);

      if (entry === undefined) throw new Error(`no handler was registered for "${kind}"`);

      return Promise.resolve(
        entry.run(descriptor, { signal: new AbortController().signal, mode: "live" })
      );
    },
    ramps: (index: number): Array<[number, number]> => context?.gains[index]?.gain.ramps ?? []
  };
}
