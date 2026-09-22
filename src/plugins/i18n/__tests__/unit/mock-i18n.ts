/**
 * @file i18n plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API and lifecycle run over a fake `flow` and a fake log,
 * so nothing is loaded from disk and nothing needs a DOM.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Api as FlowApi } from "../../../flow/types";
import { createI18nApi } from "../../api";
import { startI18n } from "../../lifecycle";
import { createI18nState } from "../../state";
import type { CompiledMessages, Config, I18nApi, I18nCtx, State } from "../../types";

/** What the fake `flow` answers with. */
export type FakeFlow = {
  features: Array<{ name: string; description: FeatureDescription }>;
  api: FlowApi;
};

/** Everything a unit test drives the plugin with. */
export type MockI18n = {
  ctx: I18nCtx;
  state: State;
  api: I18nApi;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  flow: FakeFlow;
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
 *
 * @param config - The plugin config fields the test sets.
 * @returns The context, the API, the fakes and the start step.
 */
export function createMockI18n(config: Partial<Config> = {}): MockI18n {
  const state = createI18nState();
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const flow = createFakeFlow();
  const apis: Record<string, unknown> = { flow: flow.api };

  const ctx: I18nCtx = {
    config: configOf(config),
    state,
    emit: ((name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    }) as unknown as I18nCtx["emit"],
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  return {
    ctx,
    state,
    api: createI18nApi(ctx),
    log,
    emitted,
    flow,
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
