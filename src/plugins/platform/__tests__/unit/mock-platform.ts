/**
 * @file platform plugin — the mock context of the unit tests. Not a test file. The real state,
 * API, handlers and lifecycle run over a fake `lifecycle`, a fake `flow` and a fake `input`, and
 * the fake provider of six `vi.fn`s.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Answer } from "../../../flow/gate/types";
import type { Descriptor, Api as FlowApi, FxHandler, Hint } from "../../../flow/types";
import type { InputApi } from "../../../input/types";
import type { Api as LifecycleApi, PauseReason } from "../../../lifecycle/types";
import { createPlatformApi } from "../../api";
import { createHandlers } from "../../handlers";
import { startPlatform, stopPlatform } from "../../lifecycle";
import { createPlatformState } from "../../state";
import type { Config, KernelSlice, PlatformApi, State } from "../../types";
import { createFakeProvider, type FakeProvider } from "../fake-provider";

/** One registered fx handler. */
export type Registered = { kind: string; run: FxHandler; runInFast: boolean };

/** Everything a unit test drives the plugin with. */
export type MockPlatform = {
  ctx: KernelSlice;
  state: State;
  api: PlatformApi;
  log: Log.LogApi;
  /** The fake provider; absent when the test built the plugin without one. */
  fake: FakeProvider;
  /** Whether a ui root has an `escape` button, and every key pressed. */
  input: { escape: boolean; pressed: string[] };
  /** Whether the gate is open, whether the resting node lists the intent, and every answer given. */
  gate: { open: boolean; accepts: boolean; answers: Answer[] };
  /** Whether the game is paused, and every push and pop. */
  lifecycle: { paused: boolean; pushed: PauseReason[]; popped: PauseReason[] };
  /** The fx handlers registered, and the kinds removed. */
  flow: { registered: Registered[]; removed: string[] };
  hooks: ReturnType<typeof createHandlers>;
  start(): void;
  stop(): void;
  /** Calls the registered `haptic` handler the way `flow` does. */
  fx(descriptor: Descriptor | Hint): unknown;
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

/**
 * Creates the mock plugin: the real domain files over the fakes.
 *
 * @param options - The config to merge over the defaults; `provider: false` builds it without one.
 * @param options.config - Config fields to override.
 * @param options.provider - `false` leaves `config.provider` undefined.
 * @returns The mock.
 */
export function createMockPlatform(
  options: { config?: Partial<Config>; provider?: boolean } = {}
): MockPlatform {
  const fake = createFakeProvider();
  const config: Config = {
    provider: options.provider === false ? undefined : fake.provider,
    keepAwake: false,
    ...options.config
  };
  const state = createPlatformState();
  const log = createMockLog();
  const input = { escape: false, pressed: [] as string[] };
  const gate = { open: true, accepts: false, answers: [] as Answer[] };
  const lifecycle = {
    paused: false,
    pushed: [] as PauseReason[],
    popped: [] as PauseReason[]
  };
  const flow = { registered: [] as Registered[], removed: [] as string[] };

  const apis: Record<string, unknown> = {
    input: {
      pressKey: (key: string): boolean => {
        input.pressed.push(key);

        return key === "Escape" && input.escape;
      }
    } as unknown as InputApi,
    flow: {
      gate: {
        answer: (answer: Answer): boolean => {
          gate.answers.push(answer);

          return gate.accepts;
        },
        state: () => ({ open: gate.open, allowed: [], narrowed: false })
      },
      fx: {
        handle: (kind: string, run: FxHandler, handleOptions?: { runInFast?: boolean }) => {
          const entry: Registered = { kind, run, runInFast: handleOptions?.runInFast ?? false };

          flow.registered.push(entry);

          return (): void => {
            flow.registered.splice(flow.registered.indexOf(entry), 1);
            flow.removed.push(kind);
          };
        }
      }
    } as unknown as FlowApi,
    lifecycle: {
      push: (reason: PauseReason): void => {
        lifecycle.pushed.push(reason);
        lifecycle.paused = true;
      },
      pop: (reason: PauseReason): void => {
        lifecycle.popped.push(reason);
        lifecycle.paused = false;
      },
      isPaused: (): boolean => lifecycle.paused
    } as unknown as LifecycleApi
  };

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
    state,
    api: createPlatformApi(ctx),
    log,
    fake,
    input,
    gate,
    lifecycle,
    flow,
    hooks: createHandlers(ctx),
    start: (): void => startPlatform(ctx),
    stop: (): void => stopPlatform(state),
    fx: (descriptor: Descriptor | Hint): unknown => {
      const entry = flow.registered.find(registration => registration.kind === "haptic");

      if (entry === undefined) throw new Error('no handler was registered for "haptic"');

      return entry.run(descriptor, { signal: new AbortController().signal, mode: "live" });
    }
  };
}
