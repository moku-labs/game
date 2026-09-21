import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Json, Snapshot, Transaction } from "../../../model/types";
import { createFeaturesApi } from "../../features/api";
import { createFxApi } from "../../fx/api";
import { createGateApi } from "../../gate/api";
import { createInboxApi } from "../../inbox/api";
import { runLoop, stopRunner } from "../../runner/loop";
import type {
  AnyFlow,
  AnyNode,
  AnyNodeContext,
  AnyTypeTag,
  Bookmark,
  FlowEntry,
  Modules,
  OutcomeTags,
  Result,
  Target
} from "../../runner/types";
import { walkRoute } from "../../runner/walk";
import { createFlowState } from "../../state";
import type { Config, Deps, FlowCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: walkRoute over the real gate, fx and inbox with a fake model store
// ---------------------------------------------------------------------------

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const unregister = (): void => undefined;

const tag: AnyTypeTag = { kind: "type" };

const tags = (names: readonly string[]): OutcomeTags =>
  Object.fromEntries(names.map(name => [name, tag]));

type NodeOptions = {
  outcomes?: readonly string[];
  rest?: boolean;
  checkpoint?: boolean;
  run?: (context: AnyNodeContext) => Result | Promise<Result>;
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: false,
  checkpoint: options.checkpoint ?? false,
  barrier: false,
  inbox: [],
  ...(options.run ? { run: options.run } : {})
});

const flow = (
  id: string,
  nodes: Record<string, FlowEntry>,
  start: string,
  edges: Record<string, Record<string, Target>>,
  outcomes: readonly string[] = []
): AnyFlow => ({ kind: "flow", id, input: tag, outcomes: tags(outcomes), nodes, start, edges });

/** A rest node that waits for one intent and has no body. */
const waiting = (...intents: readonly string[]): AnyNode => node({ rest: true, outcomes: intents });

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

const createStoreFake = (calls: string[]) => {
  const trees = { player: { coins: 0 }, session: { visits: 0 } };
  const restored: Bookmark[] = [];
  const transaction: Transaction = {
    player: trees.player,
    session: trees.session,
    rng: { stream: vi.fn() },
    commit: () => ({ patches: { doc: [], session: [] }, roots: [] }),
    discard: vi.fn()
  };
  const snapshot: Snapshot = {
    player: trees.player,
    session: trees.session,
    rng: { seed: 1, streams: {} }
  };

  return {
    restored,
    store: {
      load: async (): Promise<void> => {
        calls.push("load");
      },
      snapshot: (): Snapshot => snapshot,
      begin: (): Transaction => transaction,
      markRest: vi.fn(),
      markBarrier: async (): Promise<void> => undefined,
      rollback: vi.fn(),
      restore: (input: { player: Json; session: Json }): void => {
        calls.push("restore");
        restored.push(input as Bookmark);
      },
      flush: async (): Promise<void> => undefined
    }
  };
};

const setup = (main: AnyFlow) => {
  const calls: string[] = [];
  const model = createStoreFake(calls);
  const config: Config = {
    mainFlow: main,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };
  const deps: Deps = {
    time: {
      onFrame: () => unregister,
      read: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1 }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPaused: vi.fn(),
      isRunning: () => false,
      step: vi.fn()
    },
    model: { store: model.store, rng: { peek: vi.fn() } },
    clock: {
      now: () => 1000,
      scheduleAt: vi.fn(),
      onElapsed: () => unregister,
      poke: vi.fn(),
      dueAt: vi.fn()
    }
  };
  const ctx: FlowCtx = {
    global: {},
    config,
    state: createFlowState({ global: {}, config }),
    emit: vi.fn(),
    log: createMockLog(),
    require: (plugin => {
      throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
    }) as Require,
    deps
  };
  const gate = createGateApi(ctx);
  const modules: Modules = {
    features: createFeaturesApi(ctx),
    fx: createFxApi(ctx, { gate }),
    gate,
    inbox: createInboxApi(ctx)
  };

  return {
    calls,
    ctx,
    model,
    modules,
    start: (): Promise<void> => {
      const running = runLoop(ctx, modules);

      ctx.state.runner.running = running;
      running.catch(() => undefined);

      return running;
    }
  };
};

describe("walkRoute", () => {
  it("rejects before run() was called", async () => {
    const harness = setup(
      flow("main", { home: waiting("play") }, "home", { home: { play: "home" } })
    );

    await expect(walkRoute(harness.ctx, harness.modules, [])).rejects.toThrow(
      "[game] flow.walk() needs a running graph."
    );
  });

  it("answers every step through the gate and resolves with the state", async () => {
    const main = flow("main", { home: waiting("play"), shop: waiting("buy") }, "home", {
      home: { play: "shop" },
      shop: { buy: "home" }
    });
    const harness = setup(main);

    harness.start();

    const state = await walkRoute(harness.ctx, harness.modules, [
      { at: "home", intent: "play" },
      { at: "shop", intent: "buy" }
    ]);

    expect(state.path).toBe("home");
    expect(state.running).toBe(true);
    expect(harness.ctx.state.runner.journal.map(entry => entry.outcome)).toEqual(["play", "buy"]);

    await stopRunner(harness.ctx);
  });

  it("runs the walk in fast mode and restores the previous mode afterwards", async () => {
    const seen: string[] = [];
    const main = flow(
      "main",
      {
        home: waiting("play"),
        work: node({
          outcomes: ["done"],
          run: () => {
            seen.push(harness.ctx.state.fx.mode);
            return { outcome: "done", payload: noPayload };
          }
        }),
        end: waiting("again")
      },
      "home",
      { home: { play: "work" }, work: { done: "end" }, end: { again: "home" } }
    );
    const harness = setup(main);

    harness.start();
    expect(harness.ctx.state.fx.mode).toBe("live");

    await walkRoute(harness.ctx, harness.modules, [{ at: "home", intent: "play" }]);

    expect(seen).toEqual(["fast"]);
    expect(harness.ctx.state.fx.mode).toBe("live");

    await stopRunner(harness.ctx);
  });

  it("substitutes the result of a sub-flow node instead of entering it", async () => {
    const entered: string[] = [];
    const level = flow(
      "level",
      {
        play: node({
          outcomes: ["won"],
          run: () => {
            entered.push("play");
            return { outcome: "won", payload: { stars: 1 } };
          }
        })
      },
      "play",
      { play: { won: { kind: "exit", outcome: "win" } } },
      ["win"]
    );
    const main = flow("main", { home: waiting("play"), level, end: waiting("again") }, "home", {
      home: { play: "level" },
      level: { win: "end" },
      end: { again: "home" }
    });
    const harness = setup(main);

    harness.start();

    const state = await walkRoute(harness.ctx, harness.modules, [
      { at: "home", intent: "play" },
      { at: "level", result: { outcome: "win", payload: { stars: 3 } } },
      { at: "end", intent: "again" }
    ]);

    expect(entered).toEqual([]);
    expect(state.path).toBe("home");
    expect(harness.ctx.state.runner.journal.map(entry => entry.outcome)).toEqual([
      "play",
      "win",
      "again"
    ]);

    await stopRunner(harness.ctx);
  });

  it("rejects with the resting path when a step is never reached", async () => {
    const main = flow("main", { home: waiting("play"), shop: waiting("buy") }, "home", {
      home: { play: "shop" },
      shop: { buy: "home" }
    });
    const harness = setup(main);

    harness.start();

    await expect(
      walkRoute(harness.ctx, harness.modules, [
        { at: "home", intent: "play" },
        { at: "board/awaitIntent", intent: "merge" }
      ])
    ).rejects.toThrow('[game] flow.walk() never reached "board/awaitIntent".');

    expect(harness.ctx.state.fx.mode).toBe("live");

    await stopRunner(harness.ctx);
  });

  it("rejects when the gate refuses the intent of a step", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup(main);

    harness.start();

    await expect(
      walkRoute(harness.ctx, harness.modules, [{ at: "home", intent: "sell" }])
    ).rejects.toThrow('[game] flow.walk() could not answer "sell" at "home".');

    await stopRunner(harness.ctx);
  });

  it("rejects when the loop ends before the step is reached", async () => {
    const main = flow(
      "main",
      {
        boot: node({ outcomes: ["done"], run: () => new Promise<Result>(() => undefined) }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { play: "home" } }
    );
    const harness = setup(main);

    harness.start();

    const walking = walkRoute(harness.ctx, harness.modules, [{ at: "home", intent: "play" }]);
    const stopping = stopRunner(harness.ctx);

    await expect(walking).rejects.toThrow('[game] flow.walk() never reached "home".');
    await stopping;
  });

  it("restores the bookmark of options.from before the first step", async () => {
    const main = flow("main", { home: waiting("play"), shop: waiting("buy") }, "home", {
      home: { play: "shop" },
      shop: { buy: "home" }
    });
    const harness = setup(main);

    harness.start();

    const bookmark: Bookmark = {
      path: "shop",
      input: noPayload,
      player: { coins: 9 },
      session: {},
      rng: { seed: 1, streams: {} },
      graph: "any"
    };
    const state = await walkRoute(
      harness.ctx,
      harness.modules,
      [{ at: "shop", intent: "buy" }],
      bookmark
    );

    expect(harness.calls).toContain("restore");
    expect(harness.model.restored.at(-1)?.player).toEqual({ coins: 9 });
    expect(state.path).toBe("home");

    await stopRunner(harness.ctx);
  });
});
