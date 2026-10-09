import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Json, Snapshot, Transaction } from "../../../model/types";
import { createFeaturesApi } from "../../features/api";
import { createFxApi } from "../../fx/api";
import { createGateApi } from "../../gate/api";
import { createInboxApi } from "../../inbox/api";
import { createRunnerApi, stopRunner } from "../../runner/api";
import { loopSeam } from "../../runner/loop";
import { graphHash } from "../../runner/registry";
import { notifyGateOpen } from "../../runner/seam";
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
import { createFlowState } from "../../state";
import type { Config, Deps, FlowCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: a bookmark at a transit node that waits at the gate. The runner API
// over the real loop, gate, fx and inbox, with a fake model store.
// ---------------------------------------------------------------------------

const tick = async (times = 60): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const result = (outcome: string): Result => ({ outcome, payload: noPayload });

const unregister = (): void => undefined;

const tag: AnyTypeTag = { kind: "type" };

const tags = (names: readonly string[]): OutcomeTags =>
  Object.fromEntries(names.map(name => [name, tag]));

type NodeOptions = {
  outcomes?: readonly string[];
  rest?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  run?: (context: AnyNodeContext) => Result | Promise<Result>;
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: false,
  checkpoint: options.checkpoint ?? false,
  barrier: options.barrier ?? false,
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

/** The popup effect of the tests: a descriptor that takes two answers. */
const popup = { kind: "popup", answers: ["ok", "close"] };

/** What the gate of `home` takes: one intent per node it leads to. */
const homeIntents = ["open", "skip", "stuck", "pass"];

/** What the test graph recorded while it ran. */
type Trace = {
  /** The input and the mode of every run of `ask`. */
  asked: Array<{ input: unknown; mode: string }>;
  /** Every node of the sub-flow `level` that ran. */
  played: string[];
};

/** What one test changes in the graph. */
type GraphOptions = {
  /** Name of the start node, `home` by default. */
  start?: string;
  /** Body of `stuck`. By default it never ends. */
  stuck?: (context: AnyNodeContext) => Promise<Result>;
  /** Makes `skip` a barrier node: its edge to `home` waits for the write of the provider. */
  barrier?: boolean;
};

/**
 * Builds the graph of the tests: the rest checkpoint `home`; `ask`, a transit node that waits for
 * the answer of a popup; `skip`, which leaves at once for `home`; `stuck`, which never ends; and
 * `pass`, which leads into the sub-flow `level` and from there to the rest node `end`.
 *
 * @param mode - Reads the mode the graph runs in.
 * @param options - What this test changes.
 * @returns The main flow and what its nodes recorded.
 */
const createGraph = (
  mode: () => string,
  options: GraphOptions
): { main: AnyFlow; trace: Trace } => {
  const trace: Trace = { asked: [], played: [] };
  const level = flow(
    "level",
    {
      play: node({
        outcomes: ["won"],
        run: () => {
          trace.played.push("play");
          return result("won");
        }
      })
    },
    "play",
    { play: { won: { kind: "exit", outcome: "win" } } },
    ["win"]
  );
  const main = flow(
    "main",
    {
      home: node({ rest: true, checkpoint: true, outcomes: homeIntents }),
      ask: node({
        outcomes: ["ok", "close"],
        run: async context => {
          trace.asked.push({ input: context.input, mode: mode() });
          await context.fx(popup);
          return result("ok");
        }
      }),
      skip: node({ barrier: options.barrier ?? false, run: () => result("done") }),
      stuck: node({ run: options.stuck ?? (() => new Promise<Result>(() => undefined)) }),
      pass: node({ run: () => result("done") }),
      level,
      end: node({ rest: true, outcomes: ["again"] })
    },
    options.start ?? "home",
    {
      home: { open: "ask", skip: "skip", stuck: "stuck", pass: "pass" },
      ask: { ok: "home", close: "home" },
      skip: { done: "home" },
      stuck: { done: "home" },
      pass: { done: "level" },
      level: { win: "end" },
      end: { again: "home" }
    }
  );

  return { main, trace };
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

const createStoreFake = () => {
  const trees = { player: { coins: 0 }, session: { visits: 0 } };
  const restored: Json[] = [];
  // The write of a barrier edge, while the test holds it open.
  const barrier: { write: Promise<void> | undefined } = { write: undefined };
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
    barrier,
    restored,
    store: {
      load: async (): Promise<void> => undefined,
      snapshot: (): Snapshot => snapshot,
      begin: (): Transaction => transaction,
      markRest: vi.fn(),
      markBarrier: (): Promise<void> => barrier.write ?? Promise.resolve(),
      rollback: vi.fn(),
      restore: (input: { player: Json }): void => {
        restored.push(input.player);
      },
      flush: async (): Promise<void> => undefined
    }
  };
};

const setup = (options: GraphOptions = {}) => {
  const model = createStoreFake();
  const config: Config = {
    mainFlow: undefined,
    safeNode: undefined,
    retries: 1,
    settleTimeoutMs: 2000,
    journalLimit: 500
  };
  const deps: Deps = {
    time: {
      onFrame: () => unregister,
      snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1, idle: false }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      wake: vi.fn(),
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
    state: createFlowState({ config }),
    emit: vi.fn(),
    log: createMockLog(),
    require: (plugin => {
      throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
    }) as Require,
    deps
  };
  const { main, trace } = createGraph(() => ctx.state.fx.mode, options);

  config.mainFlow = main;

  const gate = createGateApi(ctx);
  const modules: Modules = {
    features: createFeaturesApi(ctx),
    fx: createFxApi(ctx, { gate }),
    gate,
    inbox: createInboxApi(ctx)
  };
  const api = createRunnerApi(ctx, modules);
  // The stages of entering a node the test holds open, by path.
  const held = new Map<string, Promise<void>>();
  // The mode every `load` stage was entered in, by path.
  const stageModes: Array<{ path: string; mode: string }> = [];
  // Every signal the popup handler was shown with: one per popup on screen.
  const shown: AbortSignal[] = [];

  api.onEnter("load", (info, { mode }) => {
    stageModes.push({ path: info.path, mode });

    return held.get(info.path);
  });
  modules.fx.handle("popup", (_descriptor, { signal }) => {
    shown.push(signal);
  });

  return {
    api,
    ctx,
    model,
    modules,
    shown,
    stageModes,
    trace,

    /**
     * Makes a bookmark of one node of the running graph, as `bookmark()` would write it.
     *
     * @param path - Path of the node.
     * @param changes - The fields that differ: another graph hash, a rest point.
     * @returns The bookmark.
     */
    bookmarkAt: (path: string, changes: Partial<Bookmark> = {}): Bookmark => ({
      path,
      input: { from: "bookmark" },
      player: { coins: 9 },
      session: { visits: 2 },
      rng: { seed: 1, streams: {} },
      graph: graphHash(api.describe()),
      ...changes
    }),

    /**
     * Holds the `load` stage of one node open until the returned function is called.
     *
     * @param path - Path of the node whose entry is held.
     * @returns The function that lets the node in.
     */
    hold: (path: string): (() => void) => {
      const gateway = Promise.withResolvers<void>();

      held.set(path, gateway.promise);

      return () => {
        held.delete(path);
        gateway.resolve();
      };
    },

    /**
     * Holds the write of the next barrier edge open until the returned function is called. The
     * edge is committed by then, but the loop has not arrived at the node it leads to.
     *
     * @returns The function that lets the write through.
     */
    holdBarrier: (): (() => void) => {
      const write = Promise.withResolvers<void>();

      model.barrier.write = write.promise;

      return () => {
        model.barrier.write = undefined;
        write.resolve();
      };
    },

    /**
     * Starts the loop and gives it the time to reach its first wait. A graph the loop refuses
     * fails the test here, not later with an empty path.
     */
    start: async (): Promise<void> => {
      const fatal: unknown[] = [];

      api.run().catch((error: unknown) => {
        fatal.push(error);
      });
      await tick();

      if (fatal.length > 0) throw fatal[0];
    }
  };
};

/**
 * Watches a promise, so a test can ask whether it has settled without awaiting it.
 *
 * @param promise - The promise to watch.
 * @returns A flag that flips when the promise resolves.
 */
const watch = (promise: Promise<unknown>): { settled: boolean } => {
  const seen = { settled: false };

  promise.then(
    () => {
      seen.settled = true;
    },
    () => undefined
  );

  return seen;
};

describe("restore() into a transit node", () => {
  it("resolves only once the gate of the node is open", async () => {
    const harness = setup();

    await harness.start();

    const release = harness.hold("ask");
    const restoring = harness.api.restore(harness.bookmarkAt("ask"));
    const restored = watch(restoring);

    await tick();

    // The loop stands in the node already: the rest seam fired, but nothing waits for an answer yet.
    expect(harness.api.state()).toMatchObject({ path: "ask", pending: {} });
    expect(restored.settled).toBe(false);

    release();
    await restoring;

    expect(harness.api.state()).toMatchObject({
      path: "ask",
      pending: { gate: ["ok", "close"] },
      mode: "live"
    });
  });

  it("runs the node live from its first line with the bookmark's input and shows its popup", async () => {
    const harness = setup();

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("ask"));

    expect(harness.trace.asked).toEqual([{ input: { from: "bookmark" }, mode: "live" }]);
    expect(harness.model.restored).toEqual([{ coins: 9 }]);
    expect(harness.shown).toHaveLength(1);
    expect(harness.shown[0]?.aborted).toBe(false);

    harness.modules.gate.answer({ intent: "ok" });
    await tick();

    expect(harness.api.state()).toMatchObject({ path: "home", pending: { gate: homeIntents } });
    await stopRunner(harness.ctx);
  });

  it("takes down the popup of the same node and shows it once more when restored while it waits", async () => {
    const harness = setup();

    await harness.start();
    harness.modules.gate.answer({ intent: "open" });
    await tick();

    expect(harness.api.state()).toMatchObject({ path: "ask", pending: { gate: ["ok", "close"] } });

    await harness.api.restore(harness.api.bookmark());

    expect(harness.shown).toHaveLength(2);
    expect(harness.shown[0]?.aborted).toBe(true);
    expect(harness.shown[0]?.reason).toBe("restore");
    expect(harness.shown[1]?.aborted).toBe(false);
    expect(harness.api.state()).toMatchObject({ path: "ask", pending: { gate: ["ok", "close"] } });
    await stopRunner(harness.ctx);
  });

  it("does not resolve on a gate the aborted old node opened before the rest seam", async () => {
    const harness = setup({ start: "skip" });
    const releaseOld = harness.hold("skip");
    const releaseNew = harness.hold("ask");

    await harness.start();

    const restoring = harness.api.restore(harness.bookmarkAt("ask"));
    const restored = watch(restoring);

    // The old node is aborted but still in its `load` stage. Its body runs after the stage, with
    // no abort check between the two, so it can open the gate once: this is that notification.
    notifyGateOpen(harness.ctx.state.runner);
    await tick();
    releaseOld();
    await tick();

    expect(harness.api.state().path).toBe("ask");
    expect(restored.settled).toBe(false);

    releaseNew();
    await restoring;

    expect(harness.api.state().pending).toEqual({ gate: ["ok", "close"] });
    await stopRunner(harness.ctx);
  });

  it("resolves when the node reaches a rest node without opening a gate", async () => {
    const harness = setup();

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("skip"));

    expect(harness.api.state().path).toBe("home");
    await tick();
    // The wait took its rest listener off; the gate listener left with the gate of `home`.
    expect(loopSeam(harness.ctx.state.runner)).toMatchObject({ rest: [], gateOpen: [] });
    await stopRunner(harness.ctx);
  });

  it("resolves when the loop ends before the node opened a gate", async () => {
    const harness = setup();

    await harness.start();

    const restoring = harness.api.restore(harness.bookmarkAt("stuck"));
    const restored = watch(restoring);

    await tick();

    expect(harness.api.state().path).toBe("stuck");
    expect(restored.settled).toBe(false);

    await stopRunner(harness.ctx);

    await expect(restoring).resolves.toBeUndefined();
  });

  it("still refuses setMode at the restored node: it waits at the gate, it does not rest", async () => {
    const harness = setup();

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("ask"));

    expect(() => harness.api.setMode("fast")).toThrow(
      "[game] flow.setMode() was called while a transit node runs."
    );
    await stopRunner(harness.ctx);
  });
});

describe("restore() into a rest node", () => {
  it("resolves when the node is entered, before its stages ran and its gate opened", async () => {
    const harness = setup();

    await harness.start();

    const release = harness.hold("home");

    await harness.api.restore(harness.bookmarkAt("home"));

    expect(harness.api.state()).toMatchObject({ path: "home", pending: {} });

    release();
    await tick();

    expect(harness.api.state().pending).toEqual({ gate: homeIntents });
    await stopRunner(harness.ctx);
  });

  it("resolves the same way for the rest point a transit bookmark of another graph falls back to", async () => {
    const harness = setup();

    await harness.start();

    const release = harness.hold("home");
    const stale = harness.bookmarkAt("ask", {
      graph: "00000000",
      rest: { path: "home", input: noPayload }
    });

    await harness.api.restore(stale);

    expect(harness.api.state()).toMatchObject({ path: "home", pending: {} });
    expect(harness.trace.asked).toEqual([]);
    expect(harness.ctx.log.info).toHaveBeenCalledExactlyOnceWith("flow:restore-fell-back", {
      from: "ask",
      to: "home"
    });

    release();
    await stopRunner(harness.ctx);
  });

  it("resolves the same way for the rest point of a bookmark whose node is gone from the graph", async () => {
    const harness = setup();

    await harness.start();

    const release = harness.hold("home");
    const gone = harness.bookmarkAt("renamed", {
      graph: "00000000",
      rest: { path: "home", input: noPayload }
    });

    await harness.api.restore(gone);

    expect(harness.api.state()).toMatchObject({ path: "home", pending: {} });
    expect(harness.model.restored).toEqual([{ coins: 9 }]);
    expect(harness.ctx.log.info).toHaveBeenCalledExactlyOnceWith("flow:restore-fell-back", {
      from: "renamed",
      to: "home"
    });

    release();
    await stopRunner(harness.ctx);
  });
});

describe("restore() called while the edge before it still arrives", () => {
  it("resolves at its own rest node, not at the rest node the edge arrives at", async () => {
    const harness = setup({ barrier: true });

    await harness.start();

    const release = harness.holdBarrier();

    // `skip` is a barrier node: its edge to `home` is committed and waits for the provider.
    harness.modules.gate.answer({ intent: "skip" });
    await tick();

    expect(harness.api.state().path).toBe("skip");

    const restoring = harness.api.restore(harness.bookmarkAt("end"));

    release();
    await restoring;

    expect(harness.api.state().path).toBe("end");
    await stopRunner(harness.ctx);
  });

  it("resolves a transit bookmark at its gate, not at the rest node the edge arrives at", async () => {
    const harness = setup({ barrier: true });

    await harness.start();

    const releaseWrite = harness.holdBarrier();
    const releaseNode = harness.hold("ask");

    harness.modules.gate.answer({ intent: "skip" });
    await tick();

    const restoring = harness.api.restore(harness.bookmarkAt("ask"));
    const restored = watch(restoring);

    releaseWrite();
    await tick();

    // The edge arrived at `home`, then the loop took the bookmark: it stands in `ask`, gate shut.
    expect(harness.api.state()).toMatchObject({ path: "ask", pending: {} });
    expect(restored.settled).toBe(false);

    releaseNode();
    await restoring;

    expect(harness.api.state().pending).toEqual({ gate: ["ok", "close"] });
    await stopRunner(harness.ctx);
  });
});

describe("bookmark() on the running loop", () => {
  it("names the node that waits for the popup, and the rest point before it", async () => {
    const harness = setup();

    await harness.start();
    harness.modules.gate.answer({ intent: "open" });
    await tick();

    expect(harness.api.bookmark()).toMatchObject({
      path: "ask",
      input: noPayload,
      rest: { path: "home", input: noPayload }
    });
    await stopRunner(harness.ctx);
  });

  it("has no rest after a transit restore: the rest frame is the transit node itself", async () => {
    const harness = setup();

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("ask"));

    const bookmark = harness.api.bookmark();

    expect(bookmark).toMatchObject({ path: "ask", input: { from: "bookmark" } });
    expect("rest" in bookmark).toBe(false);
    await stopRunner(harness.ctx);
  });

  it("has no rest when the start node is the transit node that waits", async () => {
    const harness = setup({ start: "ask" });

    await harness.start();

    const bookmark = harness.api.bookmark();

    expect(bookmark.path).toBe("ask");
    expect("rest" in bookmark).toBe(false);
    await stopRunner(harness.ctx);
  });
});

describe("walk({ from }) with a transit bookmark", () => {
  it("goes on to its route right after the enter: it does not wait for a gate", async () => {
    const harness = setup();

    await harness.start();

    const release = harness.hold("pass");
    const walking = harness.api.walk([{ at: "level", result: { outcome: "win" } }], {
      from: harness.bookmarkAt("pass")
    });

    await tick();

    // The restored node has reached no gate and no rest node, and the walk already armed its step.
    expect(harness.api.state().path).toBe("pass");
    expect(loopSeam(harness.ctx.state.runner).substitutions.has("level")).toBe(true);

    release();

    const state = await walking;

    expect(state.path).toBe("end");
    expect(harness.trace.played).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("runs the node in fast mode from its stages on and mounts no popup", async () => {
    const harness = setup();

    await harness.start();
    harness.stageModes.length = 0;

    const state = await harness.api.walk([{ at: "ask", intent: "ok" }], {
      from: harness.bookmarkAt("ask")
    });

    expect(harness.stageModes[0]).toEqual({ path: "ask", mode: "fast" });
    expect(harness.trace.asked).toEqual([{ input: { from: "bookmark" }, mode: "fast" }]);
    expect(harness.shown).toEqual([]);
    expect(state).toMatchObject({ path: "home", mode: "live" });
    await stopRunner(harness.ctx);
  });

  it("falls back to the rest point when the graph changed, and logs it", async () => {
    const harness = setup();

    await harness.start();

    const state = await harness.api.walk([], {
      from: harness.bookmarkAt("ask", {
        graph: "00000000",
        rest: { path: "home", input: noPayload }
      })
    });

    expect(state.path).toBe("home");
    expect(harness.trace.asked).toEqual([]);
    expect(harness.ctx.log.info).toHaveBeenCalledExactlyOnceWith("flow:restore-fell-back", {
      from: "ask",
      to: "home"
    });
    await stopRunner(harness.ctx);
  });

  it("is refused without a rest point when the graph changed, and the mode is put back", async () => {
    const harness = setup();

    await harness.start();

    await expect(
      harness.api.walk([], { from: harness.bookmarkAt("ask", { graph: "00000000" }) })
    ).rejects.toThrow('[game] The bookmark "ask" was made for another graph.');
    expect(harness.api.state()).toMatchObject({ path: "home", mode: "live" });
    await stopRunner(harness.ctx);
  });
});

describe("walk({ from }) with a bookmark whose node is gone from the graph", () => {
  it("falls back to the rest point, and logs it", async () => {
    const harness = setup();

    await harness.start();

    const state = await harness.api.walk([], {
      from: harness.bookmarkAt("renamed", {
        graph: "00000000",
        rest: { path: "home", input: noPayload }
      })
    });

    expect(state.path).toBe("home");
    expect(harness.model.restored).toEqual([{ coins: 9 }]);
    expect(harness.ctx.log.info).toHaveBeenCalledExactlyOnceWith("flow:restore-fell-back", {
      from: "renamed",
      to: "home"
    });
    await stopRunner(harness.ctx);
  });

  it("is refused without a rest point, as before: its path is no node of the graph", async () => {
    const harness = setup();

    await harness.start();

    await expect(
      harness.api.walk([], { from: harness.bookmarkAt("renamed", { graph: "00000000" }) })
    ).rejects.toThrow('[game] The bookmark "renamed" is not a node of the graph.');
    expect(harness.ctx.log.info).not.toHaveBeenCalled();
    expect(harness.api.state()).toMatchObject({ path: "home", mode: "live" });
    await stopRunner(harness.ctx);
  });
});

describe("walk({ from }) with a rest bookmark", () => {
  it("enters the node before it switches to fast mode, as before: its stages see the caller's mode", async () => {
    const harness = setup();

    await harness.start();
    harness.stageModes.length = 0;

    const state = await harness.api.walk([], { from: harness.bookmarkAt("end") });

    expect(harness.stageModes[0]).toEqual({ path: "end", mode: "live" });
    expect(state).toMatchObject({ path: "end", mode: "live" });
    await stopRunner(harness.ctx);
  });

  it("walks its route in fast mode once the node is entered", async () => {
    const harness = setup();

    await harness.start();
    harness.stageModes.length = 0;

    const state = await harness.api.walk([{ at: "home", intent: "open" }], {
      from: harness.bookmarkAt("home")
    });

    expect(harness.stageModes).toEqual([
      { path: "home", mode: "live" },
      { path: "ask", mode: "fast" }
    ]);
    expect(harness.shown).toEqual([]);
    expect(state).toMatchObject({ path: "ask", mode: "live" });
    await stopRunner(harness.ctx);
  });

  it("enters the rest point of a fallback the same way: the node entered is a rest node", async () => {
    const harness = setup();

    await harness.start();
    harness.stageModes.length = 0;

    await harness.api.walk([], {
      from: harness.bookmarkAt("ask", {
        graph: "00000000",
        rest: { path: "home", input: noPayload }
      })
    });

    expect(harness.stageModes[0]).toEqual({ path: "home", mode: "live" });
    await stopRunner(harness.ctx);
  });
});

describe("a body that was aborted", () => {
  it("opens no gate: its effect with answers rejects with the abort reason", async () => {
    const caught: unknown[] = [];
    const body = Promise.withResolvers<void>();
    // `stuck` awaits something that is not an effect, then asks for an answer.
    const harness = setup({
      start: "stuck",
      stuck: async context => {
        await body.promise;
        await context.fx(popup).catch((error: unknown) => {
          caught.push(error);
        });

        return result("done");
      }
    });

    await harness.start();

    const release = harness.hold("home");

    // The restore aborts `stuck` while it awaits. The loop stands in the stage of `home`.
    await harness.api.restore(harness.bookmarkAt("home"));
    body.resolve();
    await tick();

    expect(caught).toEqual(["restore"]);
    expect(harness.ctx.state.gate.open).toBeUndefined();
    expect(harness.shown).toEqual([]);

    release();
    await tick();

    // The gate `home` opens is its own: nothing was open under it.
    expect(harness.api.state()).toMatchObject({ path: "home", pending: { gate: homeIntents } });
    await stopRunner(harness.ctx);
  });

  it("narrows no gate either: a guide of the aborted body is refused the same way", async () => {
    const caught: unknown[] = [];
    const body = Promise.withResolvers<void>();
    const harness = setup({
      start: "stuck",
      stuck: async context => {
        await body.promise;
        await context
          .fx({ kind: "guide", payload: { allow: { intent: "merge" } } })
          .catch((error: unknown) => {
            caught.push(error);
          });

        return result("done");
      }
    });

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("home"));
    await tick();
    body.resolve();
    await tick();

    expect(caught).toEqual(["restore"]);
    expect(harness.modules.gate.state()).toEqual({
      open: true,
      allowed: homeIntents,
      narrowed: false
    });
    await stopRunner(harness.ctx);
  });

  it("leaves no unhandled rejection when it starts an effect it does not await", async () => {
    const unhandled = vi.fn();
    const body = Promise.withResolvers<void>();
    const harness = setup({
      start: "stuck",
      stuck: async ({ fx }) => {
        await body.promise;
        void fx(popup);

        return result("done");
      }
    });

    process.on("unhandledRejection", unhandled);

    try {
      await harness.start();
      await harness.api.restore(harness.bookmarkAt("home"));
      body.resolve();
      await tick();
      // The runtime reports a rejection nobody handled after the microtasks, in a task of its own.
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(harness.shown).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("still rejects for the body that awaits the effect: the reason reaches its catch", async () => {
    const caught: unknown[] = [];
    const body = Promise.withResolvers<void>();
    const harness = setup({
      start: "stuck",
      stuck: async context => {
        await body.promise;

        try {
          await context.fx(popup);
        } catch (error) {
          caught.push(error);
        }

        return result("done");
      }
    });

    await harness.start();
    await harness.api.restore(harness.bookmarkAt("home"));
    body.resolve();
    await tick();

    expect(caught).toEqual(["restore"]);
    await stopRunner(harness.ctx);
  });
});
