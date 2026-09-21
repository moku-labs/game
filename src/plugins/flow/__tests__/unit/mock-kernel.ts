/**
 * @file flow plugin — shared mock kernel context for the root unit tests (state, api, handlers,
 * lifecycle). Not a test file: the unit project only collects `*.test.ts`.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as ClockApi, Elapsed } from "../../../clock/types";
import type { Api as ModelApi } from "../../../model/types";
import type { FrameCallback, Phase, Api as TimeApi } from "../../../time/types";
import { createFlowState } from "../../state";
import type { Config, KernelSlice, LifecycleChanged } from "../../types";

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** What the fake dependencies recorded. */
export type Recorder = {
  requires: string[];
  frames: FrameRegistration[];
  elapsed: Array<(input: Elapsed) => void>;
  scheduled: Array<number | undefined>;
  pokes: number;
  flushes: number;
  flushResult: Promise<void>;
};

/** The mock kernel context with its fake dependencies and the recorder. */
export type MockKernel = {
  ctx: KernelSlice;
  record: Recorder;
  time: TimeApi;
  model: ModelApi;
  clock: ClockApi;
};

const noop = (): void => {};

/**
 * Builds the default flow config, the same five fields `index.ts` declares.
 *
 * @returns The plugin config used by the root unit tests.
 * @example
 * ```ts
 * const config = createTestConfig();
 * ```
 */
export function createTestConfig(): Config {
  return {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };
}

/**
 * Builds one `lifecycle:changed` payload. Only the keys a test cares about are given.
 *
 * @param changes - The keys that differ from a plain `push` of `"background"`.
 * @returns The payload of the hook.
 * @example
 * ```ts
 * handlers["lifecycle:changed"](changed({ resumed: true, action: "pop" }));
 * ```
 */
export function changed(changes: Partial<LifecycleChanged> = {}): LifecycleChanged {
  return {
    reason: "background",
    action: "push",
    reasons: ["background"],
    paused: true,
    resumed: false,
    ...changes
  };
}

/**
 * Creates an empty recorder: nothing required, registered, scheduled or flushed yet.
 *
 * @returns The recorder handed to the fake dependencies.
 * @example
 * ```ts
 * const record = createRecorder();
 * ```
 */
function createRecorder(): Recorder {
  return {
    requires: [],
    frames: [],
    elapsed: [],
    scheduled: [],
    pokes: 0,
    flushes: 0,
    flushResult: Promise.resolve()
  };
}

/**
 * Creates the engine log as spies.
 *
 * @returns A log whose every method is a spy.
 * @example
 * ```ts
 * const log = createMockLog();
 * ```
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
 * Creates a fake `time` API that records every frame registration instead of running a loop.
 *
 * @param record - The recorder of the mock kernel.
 * @returns The fake time API.
 * @example
 * ```ts
 * const time = createFakeTime(record);
 * ```
 */
function createFakeTime(record: Recorder): TimeApi {
  return {
    onFrame: (phase: Phase, callback: FrameCallback): (() => void) => {
      record.frames.push({ phase, callback });

      return noop;
    },
    snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1 }),
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: () => false,
    isRunning: () => true,
    step: vi.fn()
  };
}

/**
 * Creates a fake `clock` API that records listeners, pokes and scheduled moments.
 *
 * @param record - The recorder of the mock kernel.
 * @returns The fake clock API.
 * @example
 * ```ts
 * const clock = createFakeClock(record);
 * ```
 */
function createFakeClock(record: Recorder): ClockApi {
  return {
    now: () => 1000,
    scheduleAt: (moment: number | undefined): void => {
      record.scheduled.push(moment);
    },
    onElapsed: (listener: (input: Elapsed) => void): (() => void) => {
      record.elapsed.push(listener);

      return noop;
    },
    poke: (): void => {
      record.pokes += 1;
    },
    dueAt: () => undefined
  };
}

/**
 * Creates a fake `model` API. Only `store.flush` has behaviour: the hook tracks its promise.
 *
 * @param record - The recorder of the mock kernel.
 * @returns The fake model API.
 * @example
 * ```ts
 * const model = createFakeModel(record);
 * ```
 */
function createFakeModel(record: Recorder): ModelApi {
  return {
    store: {
      load: vi.fn(),
      snapshot: vi.fn(),
      begin: vi.fn(),
      markRest: vi.fn(),
      markBarrier: vi.fn(),
      rollback: vi.fn(),
      restore: vi.fn(),
      flush: (): Promise<void> => {
        record.flushes += 1;

        return record.flushResult;
      }
    },
    rng: { peek: vi.fn() }
  };
}

/**
 * Creates the mock kernel context of the flow plugin: the real plugin state, fake `time`, `model`
 * and `clock` behind `ctx.require`, and a recorder of everything they were asked to do.
 *
 * @returns The context, its fake dependencies and the recorder.
 * @example
 * ```ts
 * const { ctx, record, clock } = createMockKernel();
 * connectFlow(ctx);
 * expect(record.frames[0]?.phase).toBe("signals");
 * ```
 */
export function createMockKernel(): MockKernel {
  const record = createRecorder();
  const time = createFakeTime(record);
  const clock = createFakeClock(record);
  const model = createFakeModel(record);
  const apis: Record<string, unknown> = { time, model, clock };
  const config = createTestConfig();

  const ctx: KernelSlice = {
    config,
    state: createFlowState({ global: {}, config }),
    emit: vi.fn(),
    global: {},
    log: createMockLog(),
    // Partial mock of the kernel's generic `require`: the flow root resolves time, model and clock.
    require: ((plugin: { name: string }): unknown => {
      record.requires.push(plugin.name);

      return apis[plugin.name];
    }) as unknown as Require
  };

  return { ctx, record, time, model, clock };
}
