import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import { createFeaturesApi } from "../../features/api";
import { createFeaturesState } from "../../features/state";
import type { FeatureDescription } from "../../features/types";
import { createFxState } from "../../fx/state";
import type { AnyFlow } from "../../runner/types";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createFeaturesApi, createFeaturesState (mock context, no kernel)
// ---------------------------------------------------------------------------

const flowOf = (id: string): AnyFlow => ({
  kind: "flow",
  id,
  input: { kind: "type" },
  outcomes: { done: { kind: "type" } },
  nodes: {},
  start: "begin",
  edges: {}
});

const always = (): boolean => true;

// The module under test resolves no dependency through the kernel; a call is a test bug.
const refuseRequire: Require = plugin => {
  throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
};

const createMockLog = (): Log.LogApi => ({
  addSink: vi.fn(),
  clearSinks: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  expect: vi.fn(),
  info: vi.fn(),
  reset: vi.fn(),
  trace: vi.fn(() => []),
  warn: vi.fn()
});

const createMockState = (): State => ({
  features: createFeaturesState(),
  fx: createFxState(),
  gate: {
    open: undefined,
    resolve: undefined,
    held: undefined,
    narrow: undefined,
    pointerActive: false,
    wake: undefined
  },
  inbox: { queue: [], listeners: [] },
  runner: {
    flushing: undefined,
    flows: new Map(),
    enterCallbacks: { load: [], scene: [] },
    stack: [],
    restFrame: undefined,
    journal: [],
    journalIndex: 0,
    running: undefined,
    abort: undefined,
    failures: 0
  }
});

const createMockDeps = (): Deps => ({
  time: {
    onFrame: vi.fn(),
    snapshot: vi.fn(),
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(),
    isRunning: vi.fn(() => false),
    step: vi.fn()
  },
  model: {
    store: {
      load: vi.fn(),
      snapshot: vi.fn(),
      begin: vi.fn(),
      markRest: vi.fn(),
      markBarrier: vi.fn(),
      rollback: vi.fn(),
      restore: vi.fn(),
      flush: vi.fn()
    },
    rng: { peek: vi.fn() }
  },
  clock: {
    now: vi.fn(),
    scheduleAt: vi.fn(),
    onElapsed: vi.fn(),
    poke: vi.fn(),
    dueAt: vi.fn()
  }
});

const setup = () => {
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };
  const state = createMockState();
  const ctx: FlowCtx = {
    global: {},
    config,
    state,
    emit: vi.fn(),
    log: createMockLog(),
    require: refuseRequire,
    deps: createMockDeps()
  };

  return { api: createFeaturesApi(ctx), ctx, state };
};

// ─── createFeaturesState ──────────────────────────────────────

describe("createFeaturesState", () => {
  it("starts empty and unsealed", () => {
    const state = createFeaturesState();

    expect(state.byName.size).toBe(0);
    expect(state.sealed).toBe(false);
  });

  it("returns a fresh state each call", () => {
    const first = createFeaturesState();
    const second = createFeaturesState();

    first.byName.set("board", {});

    expect(second.byName.size).toBe(0);
  });
});

// ─── register ─────────────────────────────────────────────────

describe("register", () => {
  it("records the description under its name", () => {
    const { api, state } = setup();
    const description: FeatureDescription = { flows: [flowOf("board")] };

    api.register("board", description);

    expect(state.features.byName.get("board")).toBe(description);
  });

  it("accepts several features", () => {
    const { api } = setup();

    api.register("board", {});
    api.register("shop", {});

    expect(api.all()).toHaveLength(2);
  });

  it("throws for a duplicate name", () => {
    const { api } = setup();

    api.register("board", {});

    expect(() => api.register("board", {})).toThrow(/^\[game] /);
  });

  it("names the feature and what to do in the duplicate error", () => {
    const { api } = setup();

    api.register("board", {});

    expect(() => api.register("board", {})).toThrow(/"board"[\S\s]*\n {2}\S.*\.$/);
  });

  it("throws after the registry was sealed", () => {
    const { api } = setup();

    api.seal();

    expect(() => api.register("board", {})).toThrow(/^\[game] /);
  });

  it("names the feature and what to do in the sealed error", () => {
    const { api } = setup();

    api.seal();

    expect(() => api.register("late", {})).toThrow(/"late"[\S\s]*\n {2}\S.*\.$/);
  });

  it("does not record a feature that was refused", () => {
    const { api, state } = setup();

    api.seal();
    expect(() => api.register("late", {})).toThrow();

    expect(state.features.byName.has("late")).toBe(false);
  });
});

// ─── all ──────────────────────────────────────────────────────

describe("all", () => {
  it("returns an empty list when nothing is registered", () => {
    const { api } = setup();

    expect(api.all()).toEqual([]);
  });

  it("returns name and description in registration order", () => {
    const { api } = setup();
    const board: FeatureDescription = { flows: [flowOf("board")] };
    const shop: FeatureDescription = { flows: [flowOf("shop")] };

    api.register("board", board);
    api.register("shop", shop);

    expect(api.all()).toEqual([
      { name: "board", description: board },
      { name: "shop", description: shop }
    ]);
  });

  it("returns a fresh list that does not write back into the state", () => {
    const { api, state } = setup();

    api.register("board", {});
    const listed = api.all();

    expect(listed).not.toBe(api.all());
    expect(state.features.byName.size).toBe(1);
  });
});

// ─── contributions ────────────────────────────────────────────

describe("contributions", () => {
  it("returns an empty list for an unknown slot", () => {
    const { api } = setup();

    api.register("board", {});

    expect(api.contributions("afterWin")).toEqual([]);
  });

  it("returns the contribution of a slot with its feature name", () => {
    const { api } = setup();
    const reward = flowOf("reward");

    api.register("board", { contribute: { afterWin: { flow: reward, order: 10 } } });

    expect(api.contributions("afterWin")).toEqual([{ feature: "board", flow: reward, order: 10 }]);
  });

  it("sorts contributions of one slot by order", () => {
    const { api } = setup();

    api.register("late", { contribute: { afterWin: { flow: flowOf("late"), order: 30 } } });
    api.register("early", { contribute: { afterWin: { flow: flowOf("early"), order: 10 } } });
    api.register("middle", { contribute: { afterWin: { flow: flowOf("middle"), order: 20 } } });

    expect(api.contributions("afterWin").map(entry => entry.feature)).toEqual([
      "early",
      "middle",
      "late"
    ]);
  });

  it("keeps the contributions of other slots out", () => {
    const { api } = setup();

    api.register("board", {
      contribute: {
        afterWin: { flow: flowOf("reward"), order: 10 },
        afterLose: { flow: flowOf("console"), order: 10 }
      }
    });

    expect(api.contributions("afterLose").map(entry => entry.flow.id)).toEqual(["console"]);
  });

  it("carries the when guard when the contribution has one", () => {
    const { api } = setup();
    api.register("board", {
      contribute: { afterWin: { flow: flowOf("r"), order: 1, when: always } }
    });

    expect(api.contributions("afterWin")[0]?.when).toBe(always);
  });

  it("leaves the when key out when the contribution has none", () => {
    const { api } = setup();

    api.register("board", { contribute: { afterWin: { flow: flowOf("r"), order: 1 } } });

    expect(Object.keys(api.contributions("afterWin")[0] ?? {})).toEqual([
      "feature",
      "flow",
      "order"
    ]);
  });

  it("keeps equal orders in registration order, for validate to report", () => {
    const { api } = setup();

    api.register("first", { contribute: { afterWin: { flow: flowOf("a"), order: 5 } } });
    api.register("second", { contribute: { afterWin: { flow: flowOf("b"), order: 5 } } });

    expect(api.contributions("afterWin").map(entry => entry.feature)).toEqual(["first", "second"]);
  });
});

// ─── seal ─────────────────────────────────────────────────────

describe("seal", () => {
  it("marks the registry sealed", () => {
    const { api, state } = setup();

    api.seal();

    expect(state.features.sealed).toBe(true);
  });

  it("is idempotent", () => {
    const { api, state } = setup();

    api.seal();
    api.seal();

    expect(state.features.sealed).toBe(true);
  });

  it("keeps reading possible after sealing", () => {
    const { api } = setup();

    api.register("board", { contribute: { afterWin: { flow: flowOf("r"), order: 1 } } });
    api.seal();

    expect(api.all()).toHaveLength(1);
    expect(api.contributions("afterWin")).toHaveLength(1);
  });
});
