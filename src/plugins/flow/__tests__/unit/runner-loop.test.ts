import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Json, Snapshot, Transaction } from "../../../model/types";
import type { Contribution, FeaturesApi, FeaturesInternal } from "../../features/types";
import type { Descriptor, FxApi, FxInternal, Hint } from "../../fx/types";
import type { Allow, Answer, GateApi, GateInternal, GateSpec } from "../../gate/types";
import type { InboxApi, InboxInternal, WorldEvent } from "../../inbox/types";
import { restorePosition, runLoop, stopRunner } from "../../runner/loop";
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
  SlotNode,
  Target
} from "../../runner/types";
import type { Config, Deps, FlowCtx, State } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: runLoop and stopRunner with hand-written model, gate, fx, inbox
// ---------------------------------------------------------------------------

const tick = async (times = 60): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const result = (outcome: string, payload: Json = noPayload): Result => ({ outcome, payload });

const unregister = (): void => undefined;

// ─── graph builders ───────────────────────────────────────────

const tag: AnyTypeTag = { kind: "type" };

const tags = (names: readonly string[]): OutcomeTags =>
  Object.fromEntries(names.map(name => [name, tag]));

type NodeOptions = {
  outcomes?: readonly string[];
  rest?: boolean;
  over?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  inbox?: readonly string[];
  scene?: string;
  run?: (context: AnyNodeContext) => Result | Promise<Result>;
};

const node = (options: NodeOptions = {}): AnyNode => ({
  kind: "node",
  input: tag,
  outcomes: tags(options.outcomes ?? ["done"]),
  rest: options.rest ?? false,
  over: options.over ?? false,
  checkpoint: options.checkpoint ?? false,
  barrier: options.barrier ?? false,
  inbox: options.inbox ?? [],
  ...(options.scene === undefined ? {} : { scene: options.scene }),
  ...(options.run ? { run: options.run } : {})
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
  edges: Record<string, Record<string, Target>>,
  outcomes: readonly string[] = []
): AnyFlow => ({ kind: "flow", id, input: tag, outcomes: tags(outcomes), nodes, start, edges });

/** A rest node that waits for one intent and never leaves. */
const waiting = (intent: string): AnyNode => node({ rest: true, outcomes: [intent] });

// ─── fakes ────────────────────────────────────────────────────

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
  fx: {
    handlers: new Map(),
    buffered: [],
    hintListeners: [],
    settled: [],
    guides: [],
    mode: "live"
  },
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

const createStoreFake = (calls: string[], barrier: () => Promise<void>) => {
  const trees = { player: { coins: 0 }, session: { visits: 0 } };
  const restored: Array<{ player: Json }> = [];
  const transaction: Transaction = {
    player: trees.player,
    session: trees.session,
    rng: { stream: vi.fn() },
    commit: () => {
      calls.push("commit");
      return { patches: { doc: [], session: [] }, roots: [] };
    },
    discard: () => {
      calls.push("discard");
    }
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
      begin: (): Transaction => {
        calls.push("begin");
        return transaction;
      },
      markRest: (): void => {
        calls.push("markRest");
      },
      markBarrier: async (txId: string): Promise<void> => {
        calls.push(`markBarrier:${txId}`);
        await barrier();
      },
      rollback: (): void => {
        calls.push("rollback");
      },
      restore: (input: { player: Json }): void => {
        calls.push("restore");
        restored.push(input);
      },
      flush: async (): Promise<void> => {
        calls.push("flush");
      }
    }
  };
};

const createGateFake = (calls: string[]) => {
  const opened: GateSpec[] = [];
  const narrows: Array<Allow | undefined> = [];
  const waitingAnswers: Array<(answer: Answer) => void> = [];
  const gate: GateApi & GateInternal = {
    answer: (): boolean => false,
    pointer: (active: boolean): void => {
      calls.push(`pointer:${String(active)}`);
    },
    state: () => ({
      open: waitingAnswers.length > 0,
      allowed: opened.at(-1)?.allowed ?? [],
      narrowed: false
    }),
    open: (spec: GateSpec): Promise<Answer> => {
      opened.push(spec);
      calls.push(`open:${spec.allowed.join(",")}`);
      return new Promise<Answer>(resolve => {
        waitingAnswers.push(resolve);
      });
    },
    close: (): void => {
      calls.push("close");
      waitingAnswers.length = 0;
    },
    narrow: (allow: Allow | undefined): void => {
      narrows.push(allow);
    },
    clearHeld: vi.fn()
  };

  return {
    gate,
    opened,
    narrows,
    reply: (answer: Answer): void => {
      const resolve = waitingAnswers.shift();

      resolve?.(answer);
    }
  };
};

const createFxFake = (calls: string[]) => {
  const values = new Map<string, unknown>();
  const descriptors: Descriptor[] = [];
  // As in the real gateway: a guide shows something until the runner ends it, everything else does not.
  const guides = { showing: 0 };
  const fx: FxApi & FxInternal = {
    handle: vi.fn(() => unregister),
    dispatch: vi.fn(),
    onHint: vi.fn(() => unregister),
    run: async (descriptor: Descriptor): Promise<unknown> => {
      descriptors.push(descriptor);
      calls.push(`fx:${descriptor.kind}`);

      if (descriptor.kind === "guide") guides.showing += 1;

      return values.get(descriptor.kind);
    },
    buffer: (item: Hint): void => {
      calls.push(`buffer:${item.kind}`);
    },
    release: (): void => {
      calls.push("release");
    },
    drop: (): void => {
      calls.push("drop");
    },
    flushSettled: vi.fn(),
    setMode: vi.fn(),
    endGuides: (): void => {
      if (guides.showing === 0) return;

      guides.showing = 0;
      calls.push("endGuides");
    }
  };

  return { fx, values, descriptors };
};

const createInboxFake = () => {
  const queue: WorldEvent[] = [];
  const listeners: Array<() => void> = [];
  const inbox: InboxApi & InboxInternal = {
    post: (event: WorldEvent): void => {
      queue.push(event);
      const current = [...listeners];

      for (const listener of current) listener();
    },
    take: (accepted: readonly string[]): WorldEvent | undefined => {
      const index = queue.findIndex(queued => accepted.includes(queued.type));

      if (index === -1) return undefined;

      const [event] = queue.splice(index, 1);

      return event;
    },
    onPost: (listener: () => void): (() => void) => {
      listeners.push(listener);

      return () => {
        const index = listeners.indexOf(listener);

        if (index !== -1) listeners.splice(index, 1);
      };
    }
  };

  return inbox;
};

const createFeaturesFake = (contributions: Record<string, readonly Contribution[]>) => {
  const sealed = { value: false };
  const features: FeaturesApi & FeaturesInternal = {
    register: vi.fn(),
    all: () => [],
    contributions: (name: string) => contributions[name] ?? [],
    seal: (): void => {
      sealed.value = true;
    }
  };

  return { features, sealed };
};

type SetupOptions = {
  main: AnyFlow | undefined;
  config?: Partial<Config>;
  contributions?: Record<string, readonly Contribution[]>;
  running?: boolean;
  barrier?: () => Promise<void>;
};

const setup = (options: SetupOptions) => {
  const calls: string[] = [];
  const wakes: string[] = [];
  const emitted: Array<{ name: string; payload: Record<string, Json | unknown> }> = [];
  const frameListeners: Array<() => void> = [];
  const clockNow = { value: 1000 };
  const model = createStoreFake(calls, options.barrier ?? (async () => undefined));
  const gateFake = createGateFake(calls);
  const fxFake = createFxFake(calls);
  const inbox = createInboxFake();
  const featuresFake = createFeaturesFake(options.contributions ?? {});
  const deps: Deps = {
    time: {
      onFrame: (_phase, callback) => {
        const listener = (): void => {
          callback({ delta: 16, elapsed: 0, scale: 1, frame: 1, idle: false });
        };

        frameListeners.push(listener);

        return () => {
          const index = frameListeners.indexOf(listener);

          if (index !== -1) frameListeners.splice(index, 1);
        };
      },
      snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1, idle: false }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPaused: vi.fn(),
      isRunning: () => options.running ?? true,
      step: vi.fn(),
      // Recorded apart from `calls`, with the call it followed: the order is the assertion.
      wake: (): void => {
        wakes.push(calls.at(-1) ?? "start");
      }
    },
    model: { store: model.store, rng: { peek: vi.fn() } },
    clock: {
      now: () => {
        clockNow.value += 10;
        return clockNow.value;
      },
      scheduleAt: vi.fn(),
      onElapsed: vi.fn(),
      poke: vi.fn(),
      dueAt: vi.fn()
    }
  };
  const ctx: FlowCtx = {
    global: {},
    config: {
      mainFlow: options.main,
      safeNode: options.config?.safeNode,
      retries: options.config?.retries ?? 1,
      settleTimeoutMs: options.config?.settleTimeoutMs ?? 2000,
      journalLimit: options.config?.journalLimit ?? 500
    },
    state: createMockState(),
    emit: vi.fn((name: string, payload: Record<string, Json | unknown>) => {
      emitted.push({ name, payload });
    }),
    log: createMockLog(),
    require: (plugin => {
      throw new Error(`The test resolves no plugin, but ${plugin.name} was required.`);
    }) as Require,
    deps
  };
  const modules: Modules = {
    features: featuresFake.features,
    fx: fxFake.fx,
    gate: gateFake.gate,
    inbox
  };

  return {
    calls,
    wakes,
    ctx,
    emitted,
    featuresFake,
    fx: fxFake,
    gate: gateFake,
    inbox,
    modules,
    model,
    frame: (): void => {
      const current = [...frameListeners];

      for (const listener of current) listener();
    },
    start: (): Promise<void> => {
      const running = runLoop(ctx, modules);

      ctx.state.runner.running = running;
      running.catch(() => undefined);

      return running;
    }
  };
};

const payloadsOf = (
  emitted: Array<{ name: string; payload: Record<string, Json | unknown> }>,
  name: string
): Array<Record<string, Json | unknown>> =>
  emitted.filter(entry => entry.name === name).map(entry => entry.payload);

// ─── the loop ─────────────────────────────────────────────────

describe("runLoop", () => {
  it("loads, commits on the edge and marks the rest point of the next node", async () => {
    const main = flow(
      "main",
      { boot: node({ run: () => result("done") }), home: waiting("play") },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.calls.slice(0, 5)).toEqual(["load", "begin", "commit", "release", "markRest"]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    expect(harness.featuresFake.sealed.value).toBe(true);
    await stopRunner(harness.ctx);
  });

  it("releases the buffered hints after the commit and journals the edge", async () => {
    const main = flow(
      "main",
      {
        boot: node({
          run: context => {
            context.fx.emit({ kind: "sparkle", hint: true });
            return result("done", { stars: 3 });
          }
        }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.calls.slice(0, 5)).toEqual([
      "load",
      "begin",
      "buffer:sparkle",
      "commit",
      "release"
    ]);
    expect(harness.ctx.state.runner.journal).toEqual([
      expect.objectContaining({ index: 0, path: "boot", outcome: "done", next: "home" })
    ]);
    expect(payloadsOf(harness.emitted, "flow:edge")[0]).toMatchObject({
      flow: "main",
      node: "boot",
      outcome: "done",
      next: "home",
      index: 0
    });
    expect(payloadsOf(harness.emitted, "flow:rest")[0]).toEqual({
      path: "home",
      checkpoint: false
    });
    await stopRunner(harness.ctx);
  });

  it("builds the node context from the transaction, the input and the clock", async () => {
    const seen: AnyNodeContext[] = [];
    const main = flow(
      "main",
      {
        boot: node({
          run: () => result("done", { level: 2 })
        }),
        home: node({
          rest: true,
          outcomes: ["play"],
          run: context => {
            seen.push(context);
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    const [context] = seen;

    expect(context?.input).toEqual({ level: 2 });
    expect(context?.now).toBe(1020);
    expect(Object.keys(context?.out ?? {})).toEqual(["play"]);
    expect(context?.player).toEqual({ coins: 0 });
    expect(context?.signal.aborted).toBe(false);
    await stopRunner(harness.ctx);
  });

  it("discards, drops the hints, rolls back and retries the rest frame on a failure", async () => {
    const attempts = { value: 0 };
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            attempts.value += 1;

            if (attempts.value === 1) throw new Error("boom");

            return result("done");
          }
        }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.calls.slice(0, 6)).toEqual([
      "load",
      "begin",
      "discard",
      "drop",
      "close",
      "rollback"
    ]);
    expect(payloadsOf(harness.emitted, "flow:error")[0]).toMatchObject({
      path: "boot",
      rolledBackTo: "boot",
      retry: true
    });
    expect(attempts.value).toBe(2);
    await stopRunner(harness.ctx);
  });

  it("enters the safe node when the retries are used up", async () => {
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            throw new Error("boom");
          }
        }),
        home: node({ rest: true, checkpoint: true, outcomes: ["play"] })
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main, config: { safeNode: "home", retries: 1 } });

    harness.start();
    await tick();

    const errors = payloadsOf(harness.emitted, "flow:error");

    expect(errors).toHaveLength(2);
    expect(errors[1]).toMatchObject({ rolledBackTo: "home", retry: false });
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("rejects run() when the safe node itself fails", async () => {
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            throw new Error("boom");
          }
        }),
        home: node({
          rest: true,
          checkpoint: true,
          outcomes: ["play"],
          run: () => {
            throw new Error("safe boom");
          }
        })
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main, config: { safeNode: "home", retries: 1 } });
    const running = harness.start();

    await expect(running).rejects.toThrow("[game]");
  });

  it("awaits markBarrier with a deterministic transaction id after the commit", async () => {
    const main = flow(
      "main",
      {
        pay: node({ barrier: true, run: () => result("done") }),
        home: waiting("play")
      },
      "pay",
      { pay: { done: "home" }, home: { play: "pay" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.calls).toContain("markBarrier:pay#0@1010");
    expect(harness.calls.indexOf("commit")).toBeLessThan(
      harness.calls.indexOf("markBarrier:pay#0@1010")
    );
    await stopRunner(harness.ctx);
  });

  it("rejects run() when the barrier cannot be made durable", async () => {
    const main = flow(
      "main",
      { pay: node({ barrier: true, run: () => result("done") }), home: waiting("play") },
      "pay",
      { pay: { done: "home" }, home: { play: "pay" } }
    );
    const harness = setup({
      main,
      barrier: () => Promise.reject(new Error("no disk"))
    });
    const running = harness.start();

    await expect(running).rejects.toThrow("no disk");
  });

  it("enters a sub-flow and passes the payload of exit() through to the parent edge", async () => {
    const level = flow(
      "level",
      { play: node({ outcomes: ["won"], run: () => result("won", { stars: 3 }) }) },
      "play",
      { play: { won: { kind: "exit", outcome: "win" } } },
      ["win"]
    );
    const main = flow(
      "main",
      {
        level,
        home: waiting("play")
      },
      "level",
      { level: { win: "home" }, home: { play: "level" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.ctx.state.runner.journal.at(-1)).toMatchObject({
      path: "level/play",
      outcome: "won",
      next: "home"
    });
    expect(harness.ctx.state.runner.stack).toEqual([
      { flow: "main", node: "home", input: { stars: 3 } }
    ]);
    await stopRunner(harness.ctx);
  });

  it("adapts the payload with the mapper of a to() edge", async () => {
    const seen: unknown[] = [];
    const main = flow(
      "main",
      {
        load: node({ outcomes: ["failed"], run: () => result("failed", { reason: "clock" }) }),
        retry: node({
          rest: true,
          outcomes: ["again"],
          run: context => {
            seen.push(context.input);
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "load",
      {
        load: {
          failed: {
            kind: "map",
            target: "retry",
            map: (payload: unknown) => ({
              why:
                payload !== null && typeof payload === "object" && "reason" in payload
                  ? payload.reason
                  : "?"
            })
          }
        },
        retry: { again: "load" }
      }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(seen).toEqual([{ why: "clock" }]);
    await stopRunner(harness.ctx);
  });

  it("runs the contributions of a slot in order and skips the ones whose when is false", async () => {
    const ran: string[] = [];
    const contribution = (id: string): AnyFlow =>
      flow(
        id,
        {
          work: node({
            outcomes: ["done"],
            run: () => {
              ran.push(id);
              return result("done");
            }
          })
        },
        "work",
        { work: { done: { kind: "exit", outcome: "done" } } },
        ["done"]
      );
    const first = contribution("reward");
    const second = contribution("quest");
    const third = contribution("hidden");
    const main = flow(
      "main",
      { afterWin: slotNode("afterWin"), home: waiting("play") },
      "afterWin",
      { afterWin: { done: "home" }, home: { play: "afterWin" } }
    );
    const harness = setup({
      main,
      contributions: {
        afterWin: [
          { feature: "reward", flow: first, order: 10 },
          { feature: "hidden", flow: third, order: 20, when: () => false },
          { feature: "quest", flow: second, order: 30 }
        ]
      }
    });

    harness.start();
    await tick();

    expect(ran).toEqual(["reward", "quest"]);
    expect(harness.ctx.state.runner.stack).toEqual([
      { flow: "main", node: "home", input: noPayload }
    ]);
    await stopRunner(harness.ctx);
  });

  it("turns a gate answer at a pure-wait rest node into the outcome", async () => {
    const main = flow("main", { home: waiting("play"), play: waiting("home") }, "home", {
      home: { play: "play" },
      play: { home: "home" }
    });
    const harness = setup({ main });

    harness.start();
    await tick();
    harness.gate.reply({ intent: "play", payload: { level: 1 } });
    await tick();

    expect(harness.ctx.state.runner.stack).toEqual([
      { flow: "main", node: "play", input: { level: 1 } }
    ]);
    expect(harness.ctx.state.runner.journal.at(-1)).toMatchObject({ outcome: "play" });
    await stopRunner(harness.ctx);
  });

  it("delivers a world event to a pure-wait rest node that lists it", async () => {
    const main = flow(
      "main",
      {
        home: node({ rest: true, outcomes: ["play", "elapsed"], inbox: ["elapsed"] }),
        play: waiting("home")
      },
      "home",
      { home: { play: "play", elapsed: "play" }, play: { home: "home" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();
    harness.inbox.post({ type: "elapsed", payload: { now: 5 } });
    await tick();

    expect(harness.ctx.state.runner.journal.at(-1)).toMatchObject({
      outcome: "elapsed",
      payload: { now: 5 }
    });
    await stopRunner(harness.ctx);
  });

  it("aborts a rest node with a body when a world event arrives and discards its draft", async () => {
    const aborts: string[] = [];
    const main = flow(
      "main",
      {
        home: node({
          rest: true,
          outcomes: ["play", "elapsed"],
          inbox: ["elapsed"],
          run: context =>
            new Promise<Result>(() => {
              context.signal.addEventListener("abort", () => {
                aborts.push(String(context.signal.reason));
              });
            })
        }),
        play: waiting("home")
      },
      "home",
      { home: { play: "play", elapsed: "play" }, play: { home: "home" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();
    harness.inbox.post({ type: "elapsed" });
    await tick();

    expect(aborts).toEqual(["inbox"]);
    expect(harness.calls).toContain("discard");
    expect(harness.ctx.state.runner.journal.at(-1)).toMatchObject({ outcome: "elapsed" });
    expect(payloadsOf(harness.emitted, "flow:error")).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("narrows the gate while a guide runs and lifts the narrow when the node is left", async () => {
    const main = flow(
      "main",
      {
        teach: node({
          run: async context => {
            await context.fx({ kind: "guide", payload: { allow: { intent: "merge" } } });
            return result("done");
          }
        }),
        home: waiting("play")
      },
      "teach",
      { teach: { done: "home" }, home: { play: "teach" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.gate.narrows).toEqual([{ intent: "merge" }, undefined]);
    expect(harness.fx.descriptors[0]?.kind).toBe("guide");
    await stopRunner(harness.ctx);
  });

  it("ends the guide visual with the narrow it belongs to", async () => {
    const main = flow(
      "main",
      {
        teach: node({
          run: async context => {
            await context.fx({ kind: "guide", payload: { allow: { intent: "merge" } } });
            return result("done");
          }
        }),
        home: waiting("play")
      },
      "teach",
      { teach: { done: "home" }, home: { play: "teach" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    // The visual of a guide is removed by its handler's signal, which ends where the narrow does.
    expect(harness.calls.filter(call => call === "endGuides")).toHaveLength(1);
    expect(harness.calls.indexOf("endGuides")).toBeGreaterThan(harness.calls.indexOf("fx:guide"));
    expect(harness.calls.indexOf("endGuides")).toBeLessThan(harness.calls.indexOf("commit"));
    await stopRunner(harness.ctx);
  });

  it("wakes the frame loop on every edge", async () => {
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        second: node({ run: () => result("done") }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "second" }, second: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.calls.filter(call => call === "commit")).toHaveLength(2);
    expect(harness.wakes).toHaveLength(2);
    await stopRunner(harness.ctx);
  });

  it("wakes the frame loop after the commit, never before it", async () => {
    const main = flow(
      "main",
      { boot: node({ run: () => result("done") }), home: waiting("play") },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    // Every wake records the call it followed: an edge wakes the screen with its commit behind it.
    expect(harness.wakes).toEqual(["commit"]);
    await stopRunner(harness.ctx);
  });

  it("does not wake the frame loop for a node that failed", async () => {
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            throw new Error("no save");
          }
        }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main, config: { retries: 0 }, contributions: {} });

    harness.start();
    await tick();

    expect(harness.calls).toContain("rollback");
    expect(harness.wakes).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("delays an over node while the pointer is down", async () => {
    const entered: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        popup: node({
          rest: true,
          over: true,
          outcomes: ["close"],
          run: () => {
            entered.push("popup");
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "boot",
      { boot: { done: "popup" }, popup: { close: "boot" } }
    );
    const harness = setup({ main });

    harness.ctx.state.gate.pointerActive = true;
    harness.start();
    await tick();

    expect(entered).toEqual([]);

    harness.ctx.state.gate.pointerActive = false;
    harness.frame();
    await tick();

    expect(entered).toEqual(["popup"]);
    await stopRunner(harness.ctx);
  });

  it("runs the onEnter callbacks of both stages before the node body", async () => {
    const order: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            order.push("body");
            return result("done");
          }
        }),
        home: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.ctx.state.runner.enterCallbacks.load.push(info => {
      order.push(`load:${info.path}`);
    });
    harness.ctx.state.runner.enterCallbacks.scene.push(info => {
      order.push(`scene:${info.node}`);
    });
    harness.start();
    await tick();

    expect(order.slice(0, 3)).toEqual(["load:boot", "scene:boot", "body"]);
    await stopRunner(harness.ctx);
  });

  it("hands the scene of the node to the onEnter callbacks", async () => {
    const scenes: (string | undefined)[] = [];
    const main = flow(
      "main",
      { boot: node({ scene: "loading", run: () => result("done") }), home: waiting("play") },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.ctx.state.runner.enterCallbacks.scene.push(info => {
      scenes.push(info.scene);
    });
    harness.start();
    await tick();

    expect(scenes).toEqual(["loading", undefined]);
    await stopRunner(harness.ctx);
  });

  it("reports every validation problem in one error", async () => {
    const main = flow("main", { boot: node({ run: () => result("done") }) }, "boot", {});
    const harness = setup({ main });
    const running = harness.start();

    await expect(running).rejects.toThrow("has no edge");
  });

  it("rejects run() without a main flow", async () => {
    const harness = setup({ main: undefined });

    await expect(runLoop(harness.ctx, harness.modules)).rejects.toThrow("needs a main flow");
  });

  it("compacts the journal when a checkpoint is entered", async () => {
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        home: node({ rest: true, checkpoint: true, outcomes: ["play"] })
      },
      "boot",
      { boot: { done: "home" }, home: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.ctx.state.runner.journal).toEqual([]);
    expect(harness.ctx.state.runner.journalIndex).toBe(1);
    expect(payloadsOf(harness.emitted, "flow:rest")[0]).toEqual({ path: "home", checkpoint: true });
    await stopRunner(harness.ctx);
  });

  it("takes a world event that was already queued when the rest node is entered", async () => {
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            harness.inbox.post({ type: "confirmed", payload: { id: 1 } });
            return result("done");
          }
        }),
        home: node({ rest: true, inbox: ["confirmed"], outcomes: ["confirmed"] }),
        end: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { confirmed: "end" }, end: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.ctx.state.runner.journal.map(entry => entry.outcome)).toEqual([
      "done",
      "confirmed"
    ]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("takes the done edge of a slot no feature contributes to", async () => {
    const main = flow("main", { chest: slotNode("afterWin"), home: waiting("play") }, "chest", {
      chest: { done: "home" },
      home: { play: "chest" }
    });
    const harness = setup({ main });

    harness.start();
    await tick();

    expect(harness.ctx.state.runner.journal).toEqual([
      expect.objectContaining({ path: "chest", outcome: "done", next: "home" })
    ]);
    await stopRunner(harness.ctx);
  });

  it("enters an over node at once while no frame loop runs", async () => {
    const entered: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        popup: node({
          rest: true,
          over: true,
          outcomes: ["close"],
          run: () => {
            entered.push("popup");
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "boot",
      { boot: { done: "popup" }, popup: { close: "boot" } }
    );
    const harness = setup({ main, running: false });

    harness.ctx.state.gate.pointerActive = true;
    harness.start();
    await tick();

    expect(entered).toEqual(["popup"]);
    await stopRunner(harness.ctx);
  });

  it("commits a world event of a barrier node with the barrier and the entry time", async () => {
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        home: node({
          rest: true,
          barrier: true,
          inbox: ["confirmed"],
          outcomes: ["confirmed"],
          run: () => new Promise<Result>(() => undefined)
        }),
        end: waiting("play")
      },
      "boot",
      { boot: { done: "home" }, home: { confirmed: "end" }, end: { play: "boot" } }
    );
    const harness = setup({ main });

    harness.start();
    await tick();

    harness.inbox.post({ type: "confirmed", payload: { id: 7 } });
    await tick();

    expect(harness.ctx.state.runner.journal.map(entry => entry.now)).toEqual([1010, 1020]);
    expect(harness.calls).toContain("markBarrier:home#1@1020");
    await stopRunner(harness.ctx);
  });

  it("leaves a pure-wait node that was aborted while an onEnter callback ran", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });
    const held: { release: () => void } = { release: () => undefined };
    const blocked = new Promise<void>(resolve => {
      held.release = resolve;
    });
    const ended = { value: false };

    harness.ctx.state.runner.enterCallbacks.load.push(async () => {
      await blocked;
    });

    const running = harness.start();

    running.then(
      () => {
        ended.value = true;
      },
      () => undefined
    );
    await tick();

    harness.ctx.state.runner.abort?.abort("stop");
    held.release();
    await tick();

    expect(ended.value).toBe(true);
    expect(harness.calls).toContain("discard");
    expect(harness.calls).toContain("close");
    await stopRunner(harness.ctx);
  });

  it("stops waiting for the pointer when the runner is stopped mid-drag", async () => {
    const entered: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        popup: node({
          rest: true,
          over: true,
          outcomes: ["close"],
          run: () => {
            entered.push("popup");
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "boot",
      { boot: { done: "popup" }, popup: { close: "boot" } }
    );
    const harness = setup({ main });
    const ended = { value: false };

    harness.ctx.state.gate.pointerActive = true;

    const running = harness.start();

    running.then(
      () => {
        ended.value = true;
      },
      () => undefined
    );
    await tick();

    expect(entered).toEqual([]);

    const stopping = stopRunner(harness.ctx);

    harness.frame();
    await tick();

    expect(entered).toEqual([]);
    expect(ended.value).toBe(true);
    await stopping;
  });

  it("ends the pointer wait on stop without a frame, as when the clock is paused", async () => {
    const entered: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        popup: node({
          rest: true,
          over: true,
          outcomes: ["close"],
          run: () => {
            entered.push("popup");
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "boot",
      { boot: { done: "popup" }, popup: { close: "boot" } }
    );
    const harness = setup({ main });

    harness.ctx.state.gate.pointerActive = true;

    const running = harness.start();

    await tick();

    expect(harness.ctx.state.gate.wake).toBeTypeOf("function");

    // No frame runs from here on: a paused clock delivers none.
    await stopRunner(harness.ctx);
    await running.catch(() => undefined);

    expect(entered).toEqual([]);
    expect(harness.ctx.state.gate.wake).toBeUndefined();
  });
});

// ─── stopRunner ───────────────────────────────────────────────

describe("stopRunner", () => {
  it("aborts the waiting node, discards its transaction and resolves run()", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });
    const running = harness.start();

    await tick();
    await stopRunner(harness.ctx);
    await expect(running).resolves.toBeUndefined();
    expect(harness.calls).toContain("discard");
    expect(harness.ctx.state.runner.running).toBeUndefined();
  });

  it("does nothing when the loop was never started", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });

    await expect(stopRunner(harness.ctx)).resolves.toBeUndefined();
  });

  it("awaits a background flush before it returns", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });
    const flushed = { value: false };

    harness.start();
    await tick();
    harness.ctx.state.runner.flushing = Promise.resolve().then(() => {
      flushed.value = true;
    });
    await stopRunner(harness.ctx);

    expect(flushed.value).toBe(true);
  });
});

// ─── restore ──────────────────────────────────────────────────

describe("restorePosition", () => {
  it("aborts the waiting node, replaces the state and enters the bookmarked rest node", async () => {
    const main = flow("main", { home: waiting("play"), play: waiting("home") }, "home", {
      home: { play: "play" },
      play: { home: "home" }
    });
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "play",
      input: { level: 4 },
      player: { coins: 7 },
      session: { visits: 1 },
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();

    await restorePosition(harness.ctx, harness.modules, bookmark);

    expect(harness.model.restored[0]).toMatchObject({ player: { coins: 7 } });
    expect(harness.ctx.state.runner.stack).toEqual([
      { flow: "main", node: "play", input: { level: 4 } }
    ]);
    expect(harness.calls).toContain("markRest");
    await stopRunner(harness.ctx);
  });

  it("forgets the contribution a slot was left after: a restore starts every slot from its first", async () => {
    const main = flow("main", { home: waiting("play"), play: waiting("home") }, "home", {
      home: { play: "play" },
      play: { home: "home" }
    });
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "play",
      input: {},
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();
    harness.ctx.state.runner.slotAfter = "rewardPopup";

    await restorePosition(harness.ctx, harness.modules, bookmark);

    expect(harness.ctx.state.runner.slotAfter).toBeUndefined();
    await stopRunner(harness.ctx);
  });

  it("ends a pointer wait without a frame and never enters the node it waited for", async () => {
    const entered: string[] = [];
    const main = flow(
      "main",
      {
        boot: node({ run: () => result("done") }),
        popup: node({
          rest: true,
          over: true,
          outcomes: ["close"],
          run: () => {
            entered.push("popup");
            return new Promise<Result>(() => undefined);
          }
        }),
        play: waiting("home")
      },
      "boot",
      { boot: { done: "popup" }, popup: { close: "play" }, play: { home: "boot" } }
    );
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "play",
      input: {},
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.ctx.state.gate.pointerActive = true;
    harness.start();
    await tick();

    expect(harness.ctx.state.gate.wake).toBeTypeOf("function");

    // No frame runs from here on: a paused clock delivers none.
    await restorePosition(harness.ctx, harness.modules, bookmark);

    expect(entered).toEqual([]);
    expect(harness.ctx.state.runner.stack).toEqual([{ flow: "main", node: "play", input: {} }]);
    await stopRunner(harness.ctx);
  });
});

// ─── stop deadline ────────────────────────────────────────────

describe("stopRunner deadline", () => {
  it("gives up after settleTimeoutMs without a frame loop, as in a headless game", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main, running: false });

    harness.ctx.state.runner.enterCallbacks.load.push(() => new Promise<void>(() => undefined));
    harness.start();
    await tick();

    vi.useFakeTimers();
    try {
      const stopping = stopRunner(harness.ctx);

      await vi.advanceTimersByTimeAsync(harness.ctx.config.settleTimeoutMs);

      await expect(stopping).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the stop on record when the deadline won, so a loop that wakes later still stops", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });

    harness.ctx.state.runner.enterCallbacks.load.push(() => new Promise<void>(() => undefined));
    harness.start();
    await tick();

    vi.useFakeTimers();
    try {
      const stopping = stopRunner(harness.ctx);

      await vi.advanceTimersByTimeAsync(harness.ctx.config.settleTimeoutMs);
      await stopping;
    } finally {
      vi.useRealTimers();
    }

    expect(harness.ctx.state.runner.abort?.signal.reason).toBe("stop");
  });

  it("forgets the stop record when the loop settled in time", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });

    harness.start();
    await tick();
    await stopRunner(harness.ctx);

    expect(harness.ctx.state.runner.abort).toBeUndefined();
  });

  it("gives up after settleTimeoutMs of real time when a callback ignores the abort and no frame runs", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });

    harness.ctx.state.runner.enterCallbacks.load.push(() => new Promise<void>(() => undefined));
    harness.start();
    await tick();

    vi.useFakeTimers();
    try {
      const stopping = stopRunner(harness.ctx);

      await vi.advanceTimersByTimeAsync(harness.ctx.config.settleTimeoutMs);

      await expect(stopping).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
