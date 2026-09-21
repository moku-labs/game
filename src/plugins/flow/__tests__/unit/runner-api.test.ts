import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Json, Snapshot, Transaction } from "../../../model/types";
import type { FeaturesApi, FeaturesInternal } from "../../features/types";
import type { FxApi, FxInternal } from "../../fx/types";
import type { Answer, GateApi, GateInternal, GateSpec } from "../../gate/types";
import type { InboxApi, InboxInternal } from "../../inbox/types";
import { createRunnerApi, stopRunner } from "../../runner/api";
import type {
  AnyFlow,
  AnyNode,
  AnyTypeTag,
  Bookmark,
  FlowEntry,
  Modules,
  OutcomeTags,
  SlotNode,
  Target
} from "../../runner/types";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: createRunnerApi (mock context, hand-written model, gate, fx, inbox)
// ---------------------------------------------------------------------------

const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const unregister = (): void => undefined;

const tag: AnyTypeTag = { kind: "type" };

const tags = (names: readonly string[]): OutcomeTags =>
  Object.fromEntries(names.map(name => [name, tag]));

type NodeOptions = { outcomes?: readonly string[]; rest?: boolean; checkpoint?: boolean };

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: false,
  checkpoint: options.checkpoint ?? false,
  barrier: false,
  inbox: []
});

const slotNode = (name: string): SlotNode => ({
  kind: "slot",
  name,
  input: tag,
  outcomes: { done: tag }
});

const flow = (
  id: string,
  nodes: Record<string, FlowEntry>,
  start: string,
  edges: Record<string, Record<string, Target>>
): AnyFlow => ({ kind: "flow", id, input: tag, outcomes: {}, nodes, start, edges });

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
  features: { byName: new Map(), sealed: false },
  fx: { handlers: new Map(), buffered: [], settled: [], mode: "live" },
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
    slotAfter: undefined,
    journal: [],
    journalIndex: 0,
    running: undefined,
    abort: undefined,
    failures: 0
  }
});

const snapshot: Snapshot = {
  player: { coins: 7 },
  session: { visits: 1 },
  rng: { seed: 42, streams: { chest: 3 } }
};

const transaction: Transaction = {
  player: { coins: 7 },
  session: { visits: 1 },
  rng: { stream: vi.fn() },
  commit: () => ({ patches: { doc: [], session: [] }, roots: [] }),
  discard: vi.fn()
};

const setup = (main: AnyFlow | undefined, overrides: Partial<Config> = {}) => {
  const opened: GateSpec[] = [];
  const modeChanges: string[] = [];
  const gate: GateApi & GateInternal = {
    answer: (): boolean => false,
    pointer: vi.fn(),
    state: () => ({ open: false, allowed: [], narrowed: false }),
    open: (spec: GateSpec): Promise<Answer> => {
      opened.push(spec);
      return new Promise<Answer>(() => undefined);
    },
    close: vi.fn(),
    narrow: vi.fn(),
    clearHeld: vi.fn()
  };
  const fx: FxApi & FxInternal = {
    handle: vi.fn(() => unregister),
    dispatch: vi.fn(),
    run: () => Promise.resolve(undefined),
    buffer: vi.fn(),
    release: vi.fn(),
    drop: vi.fn(),
    flushSettled: vi.fn(),
    setMode: (mode: "live" | "fast"): void => {
      modeChanges.push(mode);
    }
  };
  const inbox: InboxApi & InboxInternal = {
    post: vi.fn(),
    take: () => undefined,
    onPost: () => unregister
  };
  const features: FeaturesApi & FeaturesInternal = {
    register: vi.fn(),
    all: () => [],
    contributions: () => [],
    seal: vi.fn()
  };
  const deps: Deps = {
    time: {
      onFrame: () => unregister,
      snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1 }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPaused: vi.fn(),
      isRunning: () => false,
      step: vi.fn()
    },
    model: {
      store: {
        load: () => Promise.resolve(),
        snapshot: (): Snapshot => snapshot,
        begin: (): Transaction => transaction,
        markRest: vi.fn(),
        markBarrier: () => Promise.resolve(),
        rollback: vi.fn(),
        restore: vi.fn(),
        flush: () => Promise.resolve()
      },
      rng: { peek: vi.fn() }
    },
    clock: {
      now: () => 1000,
      scheduleAt: vi.fn(),
      onElapsed: vi.fn(),
      poke: vi.fn(),
      dueAt: vi.fn()
    }
  };
  const ctx: FlowCtx = {
    global: {},
    config: {
      mainFlow: main,
      safeNode: overrides.safeNode,
      retries: overrides.retries ?? 1,
      settleTimeoutMs: overrides.settleTimeoutMs ?? 2000,
      journalLimit: overrides.journalLimit ?? 500
    },
    state: createMockState(),
    emit: vi.fn(),
    log: createMockLog(),
    require: (plugin => {
      throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
    }) as Require,
    deps
  };
  const modules: Modules = { features, fx, gate, inbox };

  return { api: createRunnerApi(ctx, modules), ctx, modules, opened, modeChanges };
};

/** The smallest running graph: one rest node that waits for one intent. */
const restingGraph = (): AnyFlow =>
  flow("main", { home: node({ rest: true, outcomes: ["play"] }) }, "home", {
    home: { play: "home" }
  });

describe("createRunnerApi", () => {
  it("runs the loop once and throws on a second run()", async () => {
    const harness = setup(restingGraph());
    const running = harness.api.run();

    running.catch(() => undefined);
    await tick();

    expect(harness.opened).toEqual([{ allowed: ["play"] }]);
    expect(() => harness.api.run()).toThrow("flow.run() was already called");
    await stopRunner(harness.ctx);
    await expect(running).resolves.toBeUndefined();
  });

  it("has no register method: a flow is part of the graph when the main flow reaches it", () => {
    const harness = setup(restingGraph());

    expect(Object.keys(harness.api)).not.toContain("register");
  });

  it("registers and removes an onEnter callback", () => {
    const harness = setup(restingGraph());
    const off = harness.api.onEnter("load", () => undefined);

    expect(harness.ctx.state.runner.enterCallbacks.load).toHaveLength(1);

    off();

    expect(harness.ctx.state.runner.enterCallbacks.load).toEqual([]);
  });

  it("describes the graph without running it", () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, checkpoint: true, outcomes: ["play"] }),
        afterWin: slotNode("afterWin")
      },
      "home",
      { home: { play: "afterWin" }, afterWin: { done: "home" } }
    );
    const harness = setup(main);
    const graph = harness.api.describe();

    expect(graph.main).toBe("main");
    expect(graph.flows.main?.start).toBe("home");
    expect(graph.flows.main?.nodes.home).toMatchObject({ rest: true, checkpoint: true });
    expect(graph.slots.afterWin).toEqual([]);
  });

  it("reports the state before the graph runs", () => {
    const harness = setup(restingGraph());

    expect(harness.api.state()).toEqual({
      running: false,
      path: "",
      stack: [],
      pending: {},
      mode: "live"
    });
  });

  it("reports the open gate as the pending answer", () => {
    const harness = setup(restingGraph());

    harness.ctx.state.gate.open = { allowed: ["play"] };

    expect(harness.api.state().pending).toEqual({ gate: ["play"] });
  });

  it("returns a copy of the journal", () => {
    const harness = setup(restingGraph());

    harness.ctx.state.runner.journal.push({
      index: 0,
      path: "home",
      outcome: "play",
      payload: noPayload,
      next: "home",
      now: 1000,
      hash: "abcd1234"
    });

    const history = harness.api.history();

    expect(history).toHaveLength(1);
    expect(history).not.toBe(harness.ctx.state.runner.journal);
  });

  it("switches the mode before run() and while the graph rests", () => {
    const main = restingGraph();
    const harness = setup(main);

    harness.api.setMode("fast");
    harness.ctx.state.runner.running = Promise.resolve();
    harness.ctx.state.runner.flows.set("main", main);
    harness.ctx.state.runner.stack = [{ flow: "main", node: "home", input: noPayload }];
    harness.api.setMode("live");

    expect(harness.modeChanges).toEqual(["fast", "live"]);
  });

  it("refuses to switch the mode while a transit node runs", () => {
    const main = flow(
      "main",
      { boot: node(), home: node({ rest: true, outcomes: ["play"] }) },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup(main);

    harness.ctx.state.runner.running = Promise.resolve();
    harness.ctx.state.runner.flows.set("main", main);
    harness.ctx.state.runner.stack = [{ flow: "main", node: "boot", input: noPayload }];

    expect(() => harness.api.setMode("fast")).toThrow("while a transit node runs");
  });

  it("bookmarks the rest point with the committed state and the graph hash", () => {
    const harness = setup(restingGraph());

    harness.ctx.state.runner.restFrame = [{ flow: "main", node: "home", input: { level: 3 } }];

    const bookmark = harness.api.bookmark();

    expect(bookmark).toMatchObject({
      path: "home",
      input: { level: 3 },
      player: { coins: 7 },
      session: { visits: 1 },
      rng: { seed: 42, streams: { chest: 3 } }
    });
    expect(bookmark.graph).toHaveLength(8);
  });

  it("refuses a bookmark without a position", () => {
    const harness = setup(restingGraph());

    expect(() => harness.api.bookmark()).toThrow("needs a position");
  });

  it("refuses to restore a plain rest node whose graph hash no longer matches", async () => {
    const harness = setup(restingGraph());
    const stale: Bookmark = {
      path: "home",
      input: noPayload,
      player: {},
      session: {},
      rng: { seed: 1, streams: {} },
      graph: "00000000"
    };

    harness.ctx.state.runner.running = Promise.resolve();

    await expect(harness.api.restore(stale)).rejects.toThrow("was made for another graph");
  });

  it("refuses to restore a node that is not a rest node", async () => {
    const main = flow(
      "main",
      { boot: node(), home: node({ rest: true, outcomes: ["play"] }) },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup(main);

    await expect(
      harness.api.restore({
        path: "boot",
        input: noPayload,
        player: {},
        session: {},
        rng: { seed: 1, streams: {} },
        graph: "00000000"
      })
    ).rejects.toThrow("is not a rest node");
  });

  it("hands a checkpoint bookmark to the running loop whatever the graph hash says", async () => {
    const main = flow(
      "main",
      { home: node({ rest: true, checkpoint: true, outcomes: ["play"] }) },
      "home",
      { home: { play: "home" } }
    );
    const harness = setup(main);
    const bookmark: Bookmark = {
      path: "home",
      input: noPayload,
      player: { coins: 1 },
      session: {},
      rng: { seed: 1, streams: {} },
      graph: "00000000"
    };

    harness.ctx.state.runner.running = new Promise<void>(() => undefined);

    const restored = harness.api.restore(bookmark);

    restored.catch(() => undefined);

    expect(harness.ctx.state.runner.seam?.restoring).toBe(bookmark);
  });

  it("refuses to restore without a main flow", async () => {
    const harness = setup(undefined);

    await expect(
      harness.api.restore({
        path: "home",
        input: noPayload,
        player: {},
        session: {},
        rng: { seed: 1, streams: {} },
        graph: "00000000"
      })
    ).rejects.toThrow("[game] flow.restore() needs a main flow.");
  });

  it("names a checkpoint of the main flow when it refuses a bookmark", async () => {
    const main = flow(
      "main",
      { boot: node(), home: node({ rest: true, checkpoint: true, outcomes: ["play"] }) },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup(main);

    await expect(
      harness.api.restore({
        path: "boot",
        input: noPayload,
        player: {},
        session: {},
        rng: { seed: 1, streams: {} },
        graph: "00000000"
      })
    ).rejects.toThrow('for example the checkpoint "home"');
  });

  it("names a checkpoint inside a sub-flow with its path", async () => {
    const board = flow(
      "board",
      { play: node({ rest: true, checkpoint: true, outcomes: ["quit"] }) },
      "play",
      { play: { quit: "play" } }
    );
    const main = flow("main", { boot: node(), board }, "boot", {
      boot: { done: "board" },
      board: { left: "boot" }
    });
    const harness = setup(main);

    await expect(
      harness.api.restore({
        path: "boot",
        input: noPayload,
        player: {},
        session: {},
        rng: { seed: 1, streams: {} },
        graph: "00000000"
      })
    ).rejects.toThrow('for example the checkpoint "board/play"');
  });

  it("restores a plain rest node while the graph hash still matches", () => {
    const harness = setup(restingGraph());

    harness.ctx.state.runner.restFrame = [{ flow: "main", node: "home", input: noPayload }];
    harness.ctx.state.runner.running = new Promise<void>(() => undefined);

    const bookmark = harness.api.bookmark();
    const restored = harness.api.restore(bookmark);

    restored.catch(() => undefined);

    expect(harness.ctx.state.runner.seam?.restoring).toBe(bookmark);
  });

  it("refuses a walk that starts from a bookmark restore would refuse", async () => {
    const main = flow(
      "main",
      { boot: node(), home: node({ rest: true, outcomes: ["play"] }) },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup(main);
    const transit: Bookmark = {
      path: "boot",
      input: noPayload,
      player: {},
      session: {},
      rng: { seed: 1, streams: {} },
      graph: "00000000"
    };

    harness.ctx.state.runner.running = new Promise<void>(() => undefined);

    await expect(harness.api.walk([], { from: transit })).rejects.toThrow("is not a rest node");
  });

  it("refuses to restore before run()", async () => {
    const harness = setup(
      flow("main", { home: node({ rest: true, checkpoint: true, outcomes: ["play"] }) }, "home", {
        home: { play: "home" }
      })
    );

    await expect(
      harness.api.restore({
        path: "home",
        input: noPayload,
        player: {},
        session: {},
        rng: { seed: 1, streams: {} },
        graph: "00000000"
      })
    ).rejects.toThrow("needs a running graph");
  });
});
