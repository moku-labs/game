/**
 * @file i18n plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API and lifecycle run over a fake `flow`, an optional fake
 * `assets` and a fake log, so nothing is loaded from disk and nothing needs a DOM.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as AssetsApi, BundleCompanion } from "../../../assets/types";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Api as FlowApi } from "../../../flow/types";
import { createI18nApi } from "../../api";
import { connectI18n } from "../../bundles";
import { startI18n } from "../../lifecycle";
import { createI18nState } from "../../state";
import type { CompiledMessages, Config, I18nApi, I18nCtx, State } from "../../types";

/** What the fake `flow` answers with. */
export type FakeFlow = {
  features: Array<{ name: string; description: FeatureDescription; parent?: string }>;
  api: FlowApi;
};

/** The bundles the fake `assets` knows: `has` reads `bundles`, `isLoaded` reads `loaded`. */
export type AssetsSetup = { bundles?: readonly string[]; loaded?: readonly string[] };

/** What the fake `assets` answers with, and the companions `i18n` handed it. */
export type FakeAssets = {
  /** The bundles of the manifest. */
  bundles: Set<string>;
  /** The bundles that count as loaded. */
  loaded: Set<string>;
  /** Every companion added, in order. */
  companions: BundleCompanion[];
  api: AssetsApi;
};

/** Everything a unit test drives the plugin with. */
export type MockI18n = {
  ctx: I18nCtx;
  state: State;
  api: I18nApi;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  /** Called on every emit, after it is recorded: a test reads the state at the moment of the event. */
  onEmit: (name: string) => void;
  flow: FakeFlow;
  /** The fake `assets`, or `undefined` when the test composed none. */
  assets: FakeAssets | undefined;
  /** The one companion `connectI18n` handed `assets`. */
  companion(): BundleCompanion;
  start(): Promise<void>;
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
 * Creates the fake `flow`: the one member `i18n` calls, backed by a list a test writes.
 *
 * @returns The fake flow and its feature list.
 */
function createFakeFlow(): FakeFlow {
  const fake: FakeFlow = { features: [], api: undefined as unknown as FlowApi };

  fake.api = { features: { all: () => fake.features } } as unknown as FlowApi;

  return fake;
}

/**
 * What `companions.add` returns: no test removes the companion.
 */
function keepCompanion(): void {
  // Nothing to remove: the fake assets dies with the test.
}

/**
 * Creates the fake `assets`: the three members `i18n` calls, backed by sets a test writes.
 *
 * @param setup - The bundles of the manifest and the ones that count as loaded.
 * @returns The fake assets and its recordings.
 */
function createFakeAssets(setup: AssetsSetup): FakeAssets {
  const fake: FakeAssets = {
    bundles: new Set(setup.bundles),
    loaded: new Set(setup.loaded),
    companions: [],
    api: undefined as unknown as AssetsApi
  };

  fake.api = {
    has: (bundle: string) => fake.bundles.has(bundle),
    isLoaded: (bundle: string) => fake.loaded.has(bundle),
    companions: {
      add: (companion: BundleCompanion) => {
        fake.companions.push(companion);

        return keepCompanion;
      }
    }
  } as unknown as AssetsApi;

  return fake;
}

/**
 * Builds the full config out of the few fields a test cares about.
 *
 * @param config - The fields the test set.
 * @returns The config the kernel would have resolved.
 */
function configOf(config: Partial<Config>): Config {
  return { locale: "ru", fallback: "en", locales: {}, ...config };
}

/**
 * Creates the mock plugin: the real state, the real API and the real lifecycle over the fakes.
 * `connectI18n` runs here, the way the kernel runs `onInit` inside `createApp`; `start` is
 * `onStart`. `require` throws for a plugin the test did not compose, like the kernel.
 *
 * @param config - The plugin config fields the test sets.
 * @param assets - The fake `assets` to compose; absent means an app without `assets`.
 * @returns The context, the API, the fakes and the start step.
 */
export function createMockI18n(config: Partial<Config> = {}, assets?: AssetsSetup): MockI18n {
  const state = createI18nState();
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const flow = createFakeFlow();
  const fakeAssets = assets === undefined ? undefined : createFakeAssets(assets);
  const apis: Record<string, unknown> = { flow: flow.api };
  const listener = { onEmit: (_name: string): void => undefined };

  if (fakeAssets !== undefined) apis.assets = fakeAssets.api;

  const ctx: I18nCtx = {
    config: configOf(config),
    state,
    emit: (name: string, payload: unknown): void => {
      emitted.push({ name, payload });
      listener.onEmit(name);
    },
    global: {},
    log,
    has: (name: string): boolean => Object.hasOwn(apis, name),
    require: ((plugin: { name: string }): unknown => {
      if (!Object.hasOwn(apis, plugin.name)) throw new Error(`not composed: ${plugin.name}`);

      return apis[plugin.name];
    }) as unknown as Require
  };
  const api = createI18nApi(ctx);

  connectI18n(ctx);

  return {
    ctx,
    state,
    api,
    log,
    emitted,
    get onEmit() {
      return listener.onEmit;
    },
    set onEmit(next) {
      listener.onEmit = next;
    },
    flow,
    assets: fakeAssets,
    companion: (): BundleCompanion => {
      const [companion] = fakeAssets?.companions ?? [];

      if (companion === undefined) throw new Error("no companion was added");

      return companion;
    },
    start: (): Promise<void> => startI18n(ctx)
  };
}

/**
 * A hand-written compiled module, the way `compileStrings` would have written it.
 *
 * @param texts - Message key to the text it renders.
 * @returns The compiled messages.
 */
export function moduleOf(texts: Record<string, string>): CompiledMessages {
  const messages: CompiledMessages = {};

  for (const [key, text] of Object.entries(texts)) {
    messages[key] = () => [{ kind: "text", text }];
  }

  return messages;
}
