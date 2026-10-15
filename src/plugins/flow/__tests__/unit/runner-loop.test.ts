import type { Log } from "@moku-labs/common/browser";
import { describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Json, Snapshot, Transaction } from "../../../model/types";
import type { Contribution, FeaturesApi, FeaturesInternal } from "../../features/types";
import { createFxApi } from "../../fx/api";
import { guide } from "../../fx/descriptors";
import type { Descriptor, FxApi, FxInternal, Hint } from "../../fx/types";
import type { Allow, Answer, GateApi, GateInternal, GateSpec } from "../../gate/types";
import type { InboxApi, InboxInternal, WorldEvent } from "../../inbox/types";
import { loopSeam, restorePosition, runLoop, stopRunner } from "../../runner/loop";
import { refuseStart } from "../../runner/node";
import type {
  AnyFlow,
  AnyNode,
  AnyNodeContext,
  AnyRecoverContext,
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
  recover?: (context: AnyRecoverContext) => void | Promise<void>;
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
  ...(options.run ? { run: options.run } : {}),
  ...(options.recover ? { recover: options.recover } : {})
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
  features: { byName: new Map(), parentOf: new Map(), sealed: false },
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
    clearHeld: vi.fn(),
    dropHeld: (): void => {
      calls.push("dropHeld");
    }
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
  // Called with every emitted event at the moment it is emitted, as the first hook of a plugin is.
  const emitListeners: Array<(name: string, payload: Record<string, Json | unknown>) => void> = [];
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
      measure: vi.fn(),
      agentClock: () => undefined,
      chargeAgent: vi.fn(),
      rate: vi.fn(),
      setRate: vi.fn(),
      frameDrawn: vi.fn(),
      frameProbed: vi.fn(),
      // Recorded apart from `calls`, with the call it followed: the order is the assertion.
      wake: (): void => {
        wakes.push(calls.at(-1) ?? "start");
      },
      wakes: () => wakes.length
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
      journalLimit: options.config?.journalLimit ?? 500,
      holdMs: options.config?.holdMs ?? 0
    },
    state: createMockState(),
    emit: vi.fn((name: string, payload: Record<string, Json | unknown>) => {
      emitted.push({ name, payload });

      const current = [...emitListeners];

      for (const listener of current) listener(name, payload);
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
    onEmit: (listener: (name: string, payload: Record<string, Json | unknown>) => void): void => {
      emitListeners.push(listener);
    },
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

// ─── failures: the log entry and the recovery ─────────────────

/** The safe node of the failure tests: a rest checkpoint, with or without `recover`. */
const safeHome = (recover?: NodeOptions["recover"]): AnyNode =>
  node({
    rest: true,
    checkpoint: true,
    outcomes: ["play", "shop"],
    ...(recover ? { recover } : {})
  });

/**
 * A graph whose start node fails on every attempt. With one retry the loop fails twice and gives
 * up: it stands on the safe node `home`, and no player answered in between.
 */
const failingBoot = (home: AnyNode, thrown: unknown = new Error("boom")): AnyFlow =>
  flow(
    "main",
    {
      boot: node({
        run: () => {
          throw thrown;
        }
      }),
      home,
      shop: waiting("leave")
    },
    "boot",
    { boot: { done: "home" }, home: { play: "boot", shop: "shop" }, shop: { leave: "home" } }
  );

const safeConfig = { safeNode: "home", retries: 1 };

/** What the store, the gate and the effects were asked to do after the loop gave up. */
const afterGiveUp = (calls: readonly string[]): string[] =>
  calls.slice(calls.lastIndexOf("rollback") + 1);

/** Collects what `run()` rejects with, so a test never awaits a loop that does not end. */
const rejectionOf = (running: Promise<void>): { error: Error | undefined } => {
  const seen: { error: Error | undefined } = { error: undefined };

  running.catch((error: unknown) => {
    seen.error = error instanceof Error ? error : new Error(String(error));
  });

  return seen;
};

const bookmarkAt = (path: string): Bookmark => ({
  path,
  input: {},
  player: {},
  session: {},
  rng: { seed: 2, streams: {} },
  graph: "deadbeef"
});

describe("the flow:error log entry", () => {
  it("writes one error entry per failure: the retry, then the give-up", async () => {
    const boom = new Error("boom");
    const harness = setup({ main: failingBoot(safeHome(), boom), config: safeConfig });

    harness.start();
    await tick();

    expect(vi.mocked(harness.ctx.log.error).mock.calls).toEqual([
      ["flow:error", { path: "boot", rolledBackTo: "boot", retry: true }, boom],
      ["flow:error", { path: "boot", rolledBackTo: "home", retry: false }, boom]
    ]);
    await stopRunner(harness.ctx);
  });

  it("writes the entry before it emits the event", async () => {
    const order: string[] = [];
    const harness = setup({
      main: failingBoot(safeHome()),
      config: { safeNode: "home", retries: 0 }
    });

    vi.mocked(harness.ctx.log.error).mockImplementation(() => {
      order.push("log");
    });
    harness.onEmit(name => {
      if (name === "flow:error") order.push("emit");
    });
    harness.start();
    await tick();

    expect(order).toEqual(["log", "emit"]);
    await stopRunner(harness.ctx);
  });

  it("logs a thrown value that is no error as an error with its text", async () => {
    const harness = setup({
      main: failingBoot(safeHome(), "no save"),
      config: { safeNode: "home", retries: 0 }
    });

    harness.start();
    await tick();

    const logged = vi.mocked(harness.ctx.log.error).mock.calls[0]?.[2];

    expect(logged).toBeInstanceOf(Error);
    expect(logged?.message).toBe("no save");
    // The event still carries the value the node threw.
    expect(payloadsOf(harness.emitted, "flow:error")[0]).toMatchObject({ error: "no save" });
    await stopRunner(harness.ctx);
  });

  it("writes no entry for the fatal failure inside the safe node", async () => {
    const home = node({
      rest: true,
      checkpoint: true,
      outcomes: ["play", "shop"],
      run: () => {
        throw new Error("safe boom");
      }
    });
    const harness = setup({ main: failingBoot(home), config: safeConfig });
    const fatal = rejectionOf(harness.start());

    await tick();

    expect(fatal.error?.message).toContain("failed while the graph was recovering");
    // Two failures of `boot`. The third, inside the safe node, rejects run() instead.
    expect(harness.ctx.log.error).toHaveBeenCalledTimes(2);
  });
});

describe("the held answer when the loop gives up", () => {
  it("drops the held answer on the give-up and keeps it on a retry", async () => {
    const harness = setup({ main: failingBoot(safeHome()), config: safeConfig });

    harness.start();
    await tick();

    const first = harness.calls.indexOf("rollback");
    const last = harness.calls.lastIndexOf("rollback");

    // The first failure is a retry: the press stays for the gate the player comes back to.
    expect(harness.calls.slice(first + 1, last)).not.toContain("dropHeld");
    // The second one moves the position to the safe node: the press belongs to the old one.
    expect(harness.calls.slice(last + 1)).toEqual(["dropHeld", "begin", "open:play,shop"]);
    await stopRunner(harness.ctx);
  });
});

describe("recover on the safe node", () => {
  it("runs recover as one committed transaction before the safe node opens its gate", async () => {
    const harness = setup({
      main: failingBoot(
        safeHome(() => {
          harness.calls.push("recover");
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();

    expect(afterGiveUp(harness.calls)).toEqual([
      "dropHeld",
      "begin",
      "recover",
      "commit",
      "release",
      "markRest",
      "begin",
      "open:play,shop"
    ]);
    await stopRunner(harness.ctx);
  });

  it("builds the recover context from the transaction and the clock, without input and out", async () => {
    const seen: AnyRecoverContext[] = [];
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          seen.push(context);
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();

    const [context] = seen;

    expect(Object.keys(context ?? {}).toSorted()).toEqual([
      "fx",
      "now",
      "player",
      "rng",
      "session",
      "signal"
    ]);
    expect(context?.player).toBe(harness.model.store.snapshot().player);
    expect(context?.session).toBe(harness.model.store.snapshot().session);
    // The clock is read once for the recovery: after the two entries of `boot`.
    expect(context?.now).toBe(1030);
    expect(context?.signal.aborted).toBe(false);
    await stopRunner(harness.ctx);
  });

  it("emits and journals the recovery as an edge of the safe node onto itself, and rests there", async () => {
    const harness = setup({ main: failingBoot(safeHome(() => undefined)), config: safeConfig });

    harness.start();
    await tick();

    expect(payloadsOf(harness.emitted, "flow:edge")).toEqual([
      {
        flow: "main",
        node: "home",
        outcome: "recover",
        payload: noPayload,
        next: "home",
        patches: { doc: [], session: [] },
        index: 0,
        now: 1030
      }
    ]);
    expect(payloadsOf(harness.emitted, "flow:rest")).toEqual([{ path: "home", checkpoint: true }]);
    expect(harness.ctx.state.runner.restFrame).toEqual([
      { flow: "main", node: "home", input: noPayload }
    ]);
    // The safe node is a checkpoint: the journal is compacted there, the index keeps counting.
    expect(harness.ctx.state.runner.journal).toEqual([]);
    expect(harness.ctx.state.runner.journalIndex).toBe(1);
    // An edge is the moment the screen has something new to show.
    expect(harness.wakes).toEqual(["commit"]);
    await stopRunner(harness.ctx);
  });

  it("makes the recovered state the rest point a later failure rolls back to", async () => {
    const recovered = { count: 0 };
    const harness = setup({
      main: failingBoot(
        safeHome(() => {
          recovered.count += 1;
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();
    harness.calls.length = 0;

    // The player goes on from the recovered home, and the transition fails again.
    harness.gate.reply({ intent: "play" });
    await tick();

    // No rest mark between the recovery and this rollback: the store returns to the recovered state.
    expect(harness.calls).toContain("rollback");
    expect(harness.calls).not.toContain("markRest");
    expect(payloadsOf(harness.emitted, "flow:error").at(-1)).toMatchObject({
      path: "boot",
      rolledBackTo: "home",
      retry: true
    });
    // That failure is a retry: `home` is entered again, and recover does not run a second time.
    expect(recovered.count).toBe(1);
    expect(harness.gate.opened).toHaveLength(2);
    await stopRunner(harness.ctx);
  });

  it("runs no recover when a failed transition is retried, only when the loop gives up", async () => {
    const recovered = { count: 0 };
    const main = flow(
      "main",
      {
        home: safeHome(() => {
          recovered.count += 1;
        }),
        board: node({
          run: () => {
            throw new Error("boom");
          }
        }),
        shop: waiting("leave")
      },
      "home",
      { home: { play: "board", shop: "shop" }, board: { done: "home" }, shop: { leave: "home" } }
    );
    const harness = setup({ main, config: safeConfig });

    harness.start();
    await tick();
    harness.gate.reply({ intent: "play" });
    await tick();

    // One failure is a retry: the loop is back at the rest node it came from.
    expect(payloadsOf(harness.emitted, "flow:error")).toEqual([
      expect.objectContaining({ rolledBackTo: "home", retry: true })
    ]);
    expect(recovered.count).toBe(0);

    harness.gate.reply({ intent: "play" });
    await tick();

    // The second failure uses the retries up: now the loop gives up and the safe node recovers.
    expect(payloadsOf(harness.emitted, "flow:error").at(-1)).toMatchObject({ retry: false });
    expect(recovered.count).toBe(1);
    await stopRunner(harness.ctx);
  });

  it("rejects run() when recover throws: the safe node could not be made safe", async () => {
    const broken = new Error("recover boom");
    const harness = setup({
      main: failingBoot(
        safeHome(() => {
          throw broken;
        })
      ),
      config: safeConfig
    });
    const fatal = rejectionOf(harness.start());

    await tick();

    expect(fatal.error?.message).toBe(
      '[game] The node "home" failed while the graph was recovering in the safe node.\n  Fix the node or point flow.safeNode at a checkpoint that cannot fail.'
    );
    expect(fatal.error?.cause).toBe(broken);
    expect(afterGiveUp(harness.calls)).toEqual([]);
    expect(harness.calls.slice(-5)).toEqual(["begin", "discard", "drop", "close", "rollback"]);
    expect(harness.gate.opened).toEqual([]);
    // The fatal failure is no event and no log entry of its own.
    expect(payloadsOf(harness.emitted, "flow:error")).toHaveLength(2);
    expect(harness.ctx.log.error).toHaveBeenCalledTimes(2);
  });

  it("rejects run() when the safe node fails after its recovery: never a loop", async () => {
    const recovered = { count: 0 };
    const home = node({
      rest: true,
      checkpoint: true,
      outcomes: ["play", "shop"],
      run: () => {
        throw new Error("safe boom");
      },
      recover: () => {
        recovered.count += 1;
      }
    });
    const harness = setup({ main: failingBoot(home), config: safeConfig });
    const fatal = rejectionOf(harness.start());

    await tick();

    expect(fatal.error?.message).toContain('The node "home" failed while the graph was recovering');
    expect(recovered.count).toBe(1);
  });

  it("enters a safe node without recover as before: no edge, no commit, no rest mark", async () => {
    const harness = setup({ main: failingBoot(safeHome()), config: safeConfig });

    harness.start();
    await tick();

    expect(afterGiveUp(harness.calls)).toEqual(["dropHeld", "begin", "open:play,shop"]);
    expect(payloadsOf(harness.emitted, "flow:edge")).toEqual([]);
    expect(payloadsOf(harness.emitted, "flow:rest")).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("runs no recover when a flow:error listener restores a bookmark", async () => {
    const recovered = { count: 0 };
    const harness = setup({
      main: failingBoot(
        safeHome(() => {
          recovered.count += 1;
        })
      ),
      config: safeConfig
    });

    harness.onEmit((name, payload) => {
      if (name !== "flow:error" || payload.retry !== false) return;

      restorePosition(harness.ctx, harness.modules, bookmarkAt("home")).catch(() => undefined);
    });
    harness.start();
    await tick();

    // The bookmark names the safe node itself, and still its recover does not touch the restored state.
    expect(recovered.count).toBe(0);
    // One drop for the give-up, one for the bookmark.
    expect(afterGiveUp(harness.calls)).toEqual([
      "dropHeld",
      "dropHeld",
      "restore",
      "markRest",
      "begin",
      "open:play,shop"
    ]);
    expect(payloadsOf(harness.emitted, "flow:edge")).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("retries a restored transit node that fails, also when the restore came after a give-up", async () => {
    const attempts = { value: 0 };
    const main = flow(
      "main",
      {
        boot: node({
          run: () => {
            throw new Error("boom");
          }
        }),
        home: node({ rest: true, checkpoint: true, outcomes: ["play", "ask"] }),
        ask: node({
          outcomes: ["ok"],
          run: () => {
            attempts.value += 1;

            if (attempts.value === 1) throw new Error("ask boom");

            return result("ok");
          }
        }),
        shop: waiting("leave")
      },
      "boot",
      {
        boot: { done: "home" },
        home: { play: "boot", ask: "ask" },
        ask: { ok: "shop" },
        shop: { leave: "home" }
      }
    );
    const harness = setup({ main, config: safeConfig });

    harness.onEmit((name, payload) => {
      if (name !== "flow:error" || payload.path !== "boot" || payload.retry !== false) return;

      restorePosition(harness.ctx, harness.modules, bookmarkAt("ask")).catch(() => undefined);
    });

    const fatal = rejectionOf(harness.start());

    await tick();

    // The bookmark is a new position: the loop is no longer inside the safe node.
    expect(fatal.error).toBeUndefined();
    expect(payloadsOf(harness.emitted, "flow:error").at(-1)).toMatchObject({
      path: "ask",
      rolledBackTo: "ask",
      retry: true
    });
    expect(attempts.value).toBe(2);
    expect(harness.gate.opened).toEqual([{ allowed: ["leave"] }]);
    await stopRunner(harness.ctx);
  });

  it("ends the loop when the runner is stopped while recover is pending", async () => {
    const signals: AbortSignal[] = [];
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          signals.push(context.signal);

          return new Promise<void>(() => undefined);
        })
      ),
      config: safeConfig
    });
    const running = harness.start();

    await tick();

    expect(signals).toHaveLength(1);
    expect(harness.ctx.state.runner.abort?.signal).toBe(signals[0]);

    await stopRunner(harness.ctx);
    await expect(running).resolves.toBeUndefined();

    expect(signals[0]?.reason).toBe("stop");
    expect(afterGiveUp(harness.calls)).toEqual(["dropHeld", "begin", "discard", "drop", "close"]);
    expect(harness.gate.opened).toEqual([]);
  });

  it("leaves a recover that settles on its abort as aborted: no failure, no edge", async () => {
    const settle = async (how: "returns" | "rejects"): Promise<string[]> => {
      const harness = setup({
        main: failingBoot(
          safeHome(
            context =>
              new Promise<void>((resolve, reject) => {
                context.signal.addEventListener("abort", () => {
                  if (how === "returns") resolve();
                  else reject(new Error("the recover gave up"));
                });
              })
          )
        ),
        config: safeConfig
      });
      const fatal = rejectionOf(harness.start());

      await tick();
      await stopRunner(harness.ctx);
      await tick();

      expect(fatal.error).toBeUndefined();
      expect(payloadsOf(harness.emitted, "flow:edge")).toEqual([]);

      return afterGiveUp(harness.calls);
    };

    expect(await settle("returns")).toEqual(["dropHeld", "begin", "discard", "drop", "close"]);
    expect(await settle("rejects")).toEqual(["dropHeld", "begin", "discard", "drop", "close"]);
  });

  it("ends the loop when a stop lands while the recovery commits, before the node is entered", async () => {
    const harness = setup({ main: failingBoot(safeHome(() => undefined)), config: safeConfig });
    const ended = { value: false };

    harness.onEmit((name, payload) => {
      if (name !== "flow:edge" || payload.outcome !== "recover") return;

      // What `stopRunner` does to the active controller, at the moment the recovery edge is out.
      harness.ctx.state.runner.abort?.abort("stop");
    });
    harness.start().then(
      () => {
        ended.value = true;
      },
      () => undefined
    );
    await tick();

    expect(ended.value).toBe(true);
    expect(harness.calls).toContain("commit");
    expect(harness.gate.opened).toEqual([]);
  });

  it("gives way to a restore that arrives while recover is pending", async () => {
    const signals: AbortSignal[] = [];
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          signals.push(context.signal);

          return new Promise<void>(() => undefined);
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();

    expect(signals).toHaveLength(1);

    await restorePosition(harness.ctx, harness.modules, bookmarkAt("shop"));
    await tick();

    expect(signals[0]?.reason).toBe("restore");
    expect(afterGiveUp(harness.calls)).toEqual([
      "dropHeld",
      "begin",
      "discard",
      "drop",
      "close",
      "dropHeld",
      "restore",
      "markRest",
      "begin",
      "open:leave"
    ]);
    expect(payloadsOf(harness.emitted, "flow:edge")).toEqual([]);
    await stopRunner(harness.ctx);
  });

  it("enters a bookmark asked for while the recovery commits, not the safe node", async () => {
    const harness = setup({ main: failingBoot(safeHome(() => undefined)), config: safeConfig });

    harness.onEmit((name, payload) => {
      if (name !== "flow:edge" || payload.outcome !== "recover") return;

      restorePosition(harness.ctx, harness.modules, bookmarkAt("shop")).catch(() => undefined);
    });
    harness.start();
    await tick();

    // The gate of `home` never opened: the loop took the bookmark in its next turn.
    expect(harness.gate.opened).toEqual([{ allowed: ["leave"] }]);
    expect(harness.ctx.state.runner.stack).toEqual([{ flow: "main", node: "shop", input: {} }]);
    await stopRunner(harness.ctx);
  });

  it("lifts the narrow and ends the guide of a recover before the node is entered", async () => {
    const harness = setup({
      main: failingBoot(
        safeHome(async context => {
          await context.fx({ kind: "guide", payload: { allow: { intent: "play" } } });
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();

    // One lift per entry of `boot`, then the guide of the recovery and its lift.
    expect(harness.gate.narrows).toEqual([undefined, undefined, { intent: "play" }, undefined]);
    expect(afterGiveUp(harness.calls)).toEqual([
      "dropHeld",
      "begin",
      "fx:guide",
      "endGuides",
      "commit",
      "release",
      "markRest",
      "begin",
      "open:play,shop"
    ]);
    await stopRunner(harness.ctx);
  });

  it("tells a walk when recover opens the gate for an answer", async () => {
    const opened = { count: 0 };
    const harness = setup({
      main: failingBoot(
        safeHome(async context => {
          await context.fx({ kind: "popup", answers: ["ok"] });
        })
      ),
      config: safeConfig
    });

    loopSeam(harness.ctx.state.runner).gateOpen.push(() => {
      opened.count += 1;
    });
    harness.start();
    await tick();

    // The popup of the recovery, then the gate of `home` itself.
    expect(opened.count).toBe(2);
    await stopRunner(harness.ctx);
  });

  it("refuses an effect a recover starts after it was aborted", async () => {
    const refused: unknown[] = [];
    const held: { context: AnyRecoverContext | undefined } = { context: undefined };
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          held.context = context;

          return new Promise<void>(() => undefined);
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();
    await stopRunner(harness.ctx);

    await held.context?.fx({ kind: "sfx" }).catch((error: unknown) => refused.push(error));

    expect(refused).toEqual(["stop"]);
    expect(harness.calls).not.toContain("fx:sfx");
  });
});

// ─── fx.start: an effect the node does not wait for ───────────

/** A transit node `boot` with the given body, then the rest node `home`. */
const startingFlow = (run: NonNullable<NodeOptions["run"]>): AnyFlow =>
  flow("main", { boot: node({ run }), home: waiting("play") }, "boot", {
    boot: { done: "home" },
    home: { play: "boot" }
  });

/**
 * Puts the real effects gateway behind the runner, so a handler runs as it does in a game: the
 * mode decides, and a `cosmetic` failure is swallowed. Without a frame loop a completion is not
 * queued for the `signals` phase.
 */
const withGateway = (harness: ReturnType<typeof setup>) => {
  const gateway = createFxApi(harness.ctx, { gate: harness.gate.gate });

  harness.modules.fx = gateway;

  return gateway;
};

/** The error entries of the log, as `[event, data, error]`. */
const errorEntriesOf = (harness: ReturnType<typeof setup>) =>
  vi.mocked(harness.ctx.log.error).mock.calls;

/** The warn entries of the log, as `[event, data]`. */
const warnEntriesOf = (harness: ReturnType<typeof setup>) =>
  vi.mocked(harness.ctx.log.warn).mock.calls;

/** The message `refuseStart` throws for a descriptor in a node, or `undefined` when it passes. */
const refusalOf = (descriptor: Descriptor, path: string): string | undefined => {
  try {
    refuseStart(descriptor, path);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
};

describe("fx.start", () => {
  it("runs the handler at once, with the node's signal, and returns undefined", async () => {
    const order: string[] = [];
    const returned: unknown[] = [];
    const signals: { handler: AbortSignal | undefined; node: AbortSignal | undefined } = {
      handler: undefined,
      node: undefined
    };
    const harness = setup({
      main: startingFlow(context => {
        signals.node = context.signal;
        returned.push(context.fx.start({ kind: "sfx", payload: { key: "ui.tap" } }));
        order.push("after start");

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("sfx", (descriptor, handlerContext) => {
      order.push(`handler:${JSON.stringify(descriptor.payload)}`);
      signals.handler = handlerContext.signal;
    });
    harness.start();
    await tick();

    expect(order).toEqual(['handler:{"key":"ui.tap"}', "after start"]);
    expect(returned).toEqual([undefined]);
    expect(signals.node).toBeInstanceOf(AbortSignal);
    expect(signals.handler).toBe(signals.node);
    await stopRunner(harness.ctx);
  });

  it("does not hold the node: the edge commits while the handler never resolves", async () => {
    const started = { count: 0 };
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("jingle", () => {
      started.count += 1;

      return new Promise<void>(() => undefined);
    });
    harness.start();
    await tick();

    expect(started.count).toBe(1);
    expect(harness.ctx.state.runner.journal).toEqual([
      expect.objectContaining({ path: "boot", outcome: "done", next: "home" })
    ]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("does not hold the node while the frame loop runs either", async () => {
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      })
    });

    withGateway(harness).handle("jingle", () => new Promise<void>(() => undefined));
    harness.start();
    await tick();

    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("writes one flow:fx-start-failed error entry when the handler rejects, and the node commits", async () => {
    const boom = new Error("no audio device");
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("jingle", () => Promise.reject(boom));
    harness.start();
    await tick();

    expect(errorEntriesOf(harness)).toEqual([
      ["flow:fx-start-failed", { path: "boot", kind: "jingle" }, boom]
    ]);
    // The failure of a started effect is never the node's: no rollback, no `flow:error`.
    expect(payloadsOf(harness.emitted, "flow:error")).toEqual([]);
    expect(harness.calls).not.toContain("rollback");
    expect(harness.ctx.state.runner.journal).toEqual([
      expect.objectContaining({ path: "boot", outcome: "done", next: "home" })
    ]);
    await stopRunner(harness.ctx);
  });

  it("writes the same entry for a handler that throws", async () => {
    const boom = new Error("no audio device");
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("jingle", () => {
      throw boom;
    });
    harness.start();
    await tick();

    expect(errorEntriesOf(harness)).toEqual([
      ["flow:fx-start-failed", { path: "boot", kind: "jingle" }, boom]
    ]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("logs a rejection that is no error as an error with its text", async () => {
    const reason: unknown = "no device";
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("jingle", () => Promise.reject(reason));
    harness.start();
    await tick();

    const [entry] = errorEntriesOf(harness);

    expect(errorEntriesOf(harness)).toHaveLength(1);
    expect(entry?.[0]).toBe("flow:fx-start-failed");
    expect(entry?.[2]).toBeInstanceOf(Error);
    expect(entry?.[2]?.message).toBe("no device");
    await stopRunner(harness.ctx);
  });

  it("writes the entry in the signals phase while the frame loop runs", async () => {
    const boom = new Error("no audio device");
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "jingle" });

        return result("done");
      })
    });
    const gateway = withGateway(harness);

    gateway.handle("jingle", () => Promise.reject(boom));
    harness.start();
    await tick();

    // The completion of an effect waits for the next `signals` phase, a failed one too.
    expect(errorEntriesOf(harness)).toEqual([]);

    gateway.flushSettled();
    await tick();

    expect(errorEntriesOf(harness)).toEqual([
      ["flow:fx-start-failed", { path: "boot", kind: "jingle" }, boom]
    ]);
    await stopRunner(harness.ctx);
  });

  it("writes the flow:fx-cosmetic-failed warn and no flow:fx-start-failed when the handler of a cosmetic descriptor rejects", async () => {
    const started = { count: 0 };
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "sfx", payload: { key: "ui.tap" }, cosmetic: true });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("sfx", () => {
      started.count += 1;

      return Promise.reject(new Error("no audio device"));
    });
    harness.start();
    await tick();

    expect(started.count).toBe(1);
    expect(warnEntriesOf(harness)).toEqual([
      ["flow:fx-cosmetic-failed", { kind: "sfx", message: "no audio device" }]
    ]);
    // The gateway swallowed the failure, so the started effect did not fail: no error entry.
    expect(errorEntriesOf(harness)).toEqual([]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("writes the same warn for a cosmetic handler that throws", async () => {
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "play", cosmetic: true });

        return result("done");
      }),
      running: false
    });

    withGateway(harness).handle("play", () => {
      throw new Error("not registered");
    });
    harness.start();
    await tick();

    expect(warnEntriesOf(harness)).toEqual([
      ["flow:fx-cosmetic-failed", { kind: "play", message: "not registered" }]
    ]);
    expect(errorEntriesOf(harness)).toEqual([]);
    // Never the node's failure: the edge committed.
    expect(harness.ctx.state.runner.journal).toEqual([
      expect.objectContaining({ path: "boot", outcome: "done", next: "home" })
    ]);
    await stopRunner(harness.ctx);
  });

  it("does not log the abort of the node as a failed cosmetic effect", async () => {
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "play", cosmetic: true });

        return new Promise<Result>(() => undefined);
      }),
      running: false
    });

    // A handler that honours the signal: it rejects when the node is aborted.
    withGateway(harness).handle(
      "play",
      (_descriptor, handlerContext) =>
        new Promise<void>((_resolve, reject) => {
          handlerContext.signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        })
    );
    harness.start();
    await tick();
    await stopRunner(harness.ctx);
    await tick();

    expect(warnEntriesOf(harness)).toEqual([]);
    expect(errorEntriesOf(harness)).toEqual([]);
  });

  it("refuses a descriptor with answers and a guide: an answer has to be awaited", async () => {
    const thrown: unknown[] = [];
    const harness = setup({
      main: startingFlow(context => {
        try {
          context.fx.start({ kind: "popup", answers: ["ok"] });
        } catch (error) {
          thrown.push(error);
        }

        try {
          context.fx.start(guide({ allow: { intent: "play" } }));
        } catch (error) {
          thrown.push(error);
        }

        return result("done");
      })
    });

    harness.start();
    await tick();

    const messages = thrown.map(error => (error instanceof Error ? error.message : String(error)));

    expect(messages).toEqual([
      '[game] fx.start() got the effect "popup" in the node "boot", and its answer has to be awaited.\n  Write await fx(...) for a descriptor with answers and for a guide.',
      '[game] fx.start() got the effect "guide" in the node "boot", and its answer has to be awaited.\n  Write await fx(...) for a descriptor with answers and for a guide.'
    ]);
    // Nothing was started: no effect ran, no gate opened for the popup, no narrow was set.
    expect(harness.calls).not.toContain("fx:popup");
    expect(harness.calls).not.toContain("fx:guide");
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    expect(harness.gate.narrows).toEqual([undefined]);
    await stopRunner(harness.ctx);
  });

  it("refuseStart throws that message for answers and for a guide, and nothing for the rest", () => {
    expect(refusalOf({ kind: "popup", answers: ["ok"] }, "board/place")).toBe(
      '[game] fx.start() got the effect "popup" in the node "board/place", and its answer has to be awaited.\n  Write await fx(...) for a descriptor with answers and for a guide.'
    );
    expect(refusalOf(guide({ allow: { intent: "play" } }), "board/place")).toBe(
      '[game] fx.start() got the effect "guide" in the node "board/place", and its answer has to be awaited.\n  Write await fx(...) for a descriptor with answers and for a guide.'
    );
    // An empty `answers` still asks for an answer: the gate would open for no intent.
    expect(refusalOf({ kind: "popup", answers: [] }, "board/place")).toContain(
      'got the effect "popup"'
    );
    expect(
      refusalOf({ kind: "sfx", payload: { key: "ui.tap" }, cosmetic: true }, "board/place")
    ).toBeUndefined();
    expect(refusalOf({ kind: "load" }, "board/place")).toBeUndefined();
  });

  it("fails the node like any thrown error when the refusal is not caught", async () => {
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "popup", answers: ["ok"] });

        return result("done");
      }),
      config: { retries: 0 }
    });
    const fatal = rejectionOf(harness.start());

    await tick();

    expect(errorEntriesOf(harness)[0]?.[0]).toBe("flow:error");
    expect(errorEntriesOf(harness)[0]?.[2]?.message).toContain("fx.start() got the effect");
    // `boot` is the safe node of this graph, so its second failure is fatal.
    expect(fatal.error?.message).toContain("failed while the graph was recovering");
  });

  it("starts nothing and throws nothing after the abort of the node", async () => {
    const held: { context: AnyNodeContext | undefined } = { context: undefined };
    const returned: unknown[] = [];
    const harness = setup({
      main: startingFlow(context => {
        held.context = context;

        return new Promise<Result>(() => undefined);
      })
    });

    harness.start();
    await tick();
    await stopRunner(harness.ctx);

    expect(held.context?.signal.aborted).toBe(true);
    returned.push(
      held.context?.fx.start({ kind: "sfx" }),
      // Also the descriptors `start` refuses: an aborted body gets no error from it.
      held.context?.fx.start({ kind: "popup", answers: ["ok"] }),
      held.context?.fx.start(guide({ allow: { intent: "play" } }))
    );

    expect(returned).toEqual([undefined, undefined, undefined]);
    expect(harness.calls.filter(call => call.startsWith("fx:"))).toEqual([]);
    expect(harness.gate.narrows).toEqual([undefined]);
  });

  it("does not log the abort of the node as a failed effect", async () => {
    const stopped: string[] = [];
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "load" });

        return new Promise<Result>(() => undefined);
      }),
      running: false
    });

    // A handler that honours the signal: it rejects when the node is aborted.
    withGateway(harness).handle(
      "load",
      (_descriptor, handlerContext) =>
        new Promise<void>((_resolve, reject) => {
          handlerContext.signal.addEventListener(
            "abort",
            () => {
              stopped.push("handler");
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        })
    );
    harness.start();
    await tick();

    expect(errorEntriesOf(harness)).toEqual([]);

    await stopRunner(harness.ctx);
    await tick();

    expect(stopped).toEqual(["handler"]);
    expect(errorEntriesOf(harness)).toEqual([]);
  });

  it("skips a handler without runInFast in fast mode and runs one that has it", async () => {
    const ran: string[] = [];
    const harness = setup({
      main: startingFlow(context => {
        context.fx.start({ kind: "sfx" });
        context.fx.start({ kind: "load" });

        return result("done");
      }),
      running: false
    });
    const gateway = withGateway(harness);

    gateway.handle("sfx", (_descriptor, handlerContext) => {
      ran.push(`sfx:${handlerContext.mode}`);
    });
    gateway.handle(
      "load",
      (_descriptor, handlerContext) => {
        ran.push(`load:${handlerContext.mode}`);
      },
      { runInFast: true }
    );
    gateway.setMode("fast");
    harness.start();
    await tick();

    expect(ran).toEqual(["load:fast"]);
    expect(harness.gate.opened).toEqual([{ allowed: ["play"] }]);
    await stopRunner(harness.ctx);
  });

  it("starts an effect from recover, inside the recovery transaction", async () => {
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          harness.calls.push(`start:${String(context.fx.start({ kind: "sfx" }))}`);
        })
      ),
      config: safeConfig
    });

    harness.start();
    await tick();

    expect(afterGiveUp(harness.calls)).toEqual([
      "dropHeld",
      "begin",
      "fx:sfx",
      "start:undefined",
      "commit",
      "release",
      "markRest",
      "begin",
      "open:play,shop"
    ]);
    await stopRunner(harness.ctx);
  });

  it("names the safe node in the entry of an effect that recover started", async () => {
    const boom = new Error("no audio device");
    const harness = setup({
      main: failingBoot(
        safeHome(context => {
          context.fx.start({ kind: "jingle" });
        })
      ),
      config: safeConfig,
      running: false
    });

    withGateway(harness).handle("jingle", () => Promise.reject(boom));
    harness.start();
    await tick();

    expect(errorEntriesOf(harness).filter(entry => entry[0] === "flow:fx-start-failed")).toEqual([
      ["flow:fx-start-failed", { path: "home", kind: "jingle" }, boom]
    ]);
    // The recovery still committed: the safe node opened its gate.
    expect(harness.gate.opened).toEqual([{ allowed: ["play", "shop"] }]);
    await stopRunner(harness.ctx);
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

  it("drops a held answer when the bookmark is entered: the press belongs to the old position", async () => {
    const main = flow("main", { home: waiting("play"), play: waiting("home") }, "home", {
      home: { play: "play" },
      play: { home: "home" }
    });
    const harness = setup({ main });

    harness.start();
    await tick();
    harness.calls.length = 0;

    await restorePosition(harness.ctx, harness.modules, bookmarkAt("play"));
    await tick();

    // Before the node of the bookmark opens its gate: that gate is never offered the old press.
    expect(harness.calls.filter(call => call === "dropHeld")).toHaveLength(1);
    expect(harness.calls.indexOf("dropHeld")).toBeLessThan(harness.calls.indexOf("open:home"));
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

  it("runs a transit node again from its start, with the bookmark's input and state", async () => {
    const seen: unknown[] = [];
    const main = flow(
      "main",
      {
        home: waiting("play"),
        ask: node({
          outcomes: ["ok"],
          run: context => {
            seen.push(context.input);
            return new Promise<Result>(() => undefined);
          }
        })
      },
      "home",
      { home: { play: "ask" }, ask: { ok: "home" } }
    );
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "ask",
      input: { level: 4 },
      player: { coins: 7 },
      session: { visits: 1 },
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();
    harness.calls.length = 0;

    await restorePosition(harness.ctx, harness.modules, bookmark);
    await tick();

    const frames = [{ flow: "main", node: "ask", input: { level: 4 } }];

    expect(seen).toEqual([{ level: 4 }]);
    expect(harness.model.restored).toEqual([
      { player: { coins: 7 }, session: { visits: 1 }, rng: { seed: 2, streams: {} } }
    ]);
    // The state is replaced and marked before the node opens its transaction on it.
    expect(harness.calls.filter(call => ["restore", "markRest", "begin"].includes(call))).toEqual([
      "restore",
      "markRest",
      "begin"
    ]);
    expect(harness.ctx.state.runner.stack).toEqual(frames);
    expect(harness.ctx.state.runner.restFrame).toEqual(frames);
    await stopRunner(harness.ctx);
  });

  it("retries the restored transit node itself when it fails", async () => {
    const seen: unknown[] = [];
    const main = flow(
      "main",
      {
        home: waiting("play"),
        ask: node({
          outcomes: ["ok"],
          run: context => {
            seen.push(context.input);

            if (seen.length === 1) throw new Error("boom");

            return new Promise<Result>(() => undefined);
          }
        })
      },
      "home",
      { home: { play: "ask" }, ask: { ok: "home" } }
    );
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "ask",
      input: { level: 4 },
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();

    await restorePosition(harness.ctx, harness.modules, bookmark);
    await tick();

    expect(payloadsOf(harness.emitted, "flow:error")).toEqual([
      expect.objectContaining({ path: "ask", rolledBackTo: "ask", retry: true })
    ]);
    expect(seen).toEqual([{ level: 4 }, { level: 4 }]);
    expect(harness.calls).toContain("rollback");
    await stopRunner(harness.ctx);
  });

  it("announces a restored transit node as no checkpoint, also when it carries the flag", async () => {
    const main = flow(
      "main",
      {
        home: waiting("play"),
        ask: node({
          outcomes: ["ok"],
          checkpoint: true,
          run: () => new Promise<Result>(() => undefined)
        })
      },
      "home",
      { home: { play: "ask" }, ask: { ok: "home" } }
    );
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "ask",
      input: {},
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();

    await restorePosition(harness.ctx, harness.modules, bookmark);

    expect(payloadsOf(harness.emitted, "flow:rest").at(-1)).toEqual({
      path: "ask",
      checkpoint: false
    });
    await stopRunner(harness.ctx);
  });

  it("announces a restored rest checkpoint as a checkpoint", async () => {
    const main = flow(
      "main",
      {
        home: waiting("play"),
        shop: node({ rest: true, checkpoint: true, outcomes: ["leave"] })
      },
      "home",
      { home: { play: "shop" }, shop: { leave: "home" } }
    );
    const harness = setup({ main });
    const bookmark: Bookmark = {
      path: "shop",
      input: {},
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    harness.start();
    await tick();

    await restorePosition(harness.ctx, harness.modules, bookmark);

    expect(payloadsOf(harness.emitted, "flow:rest").at(-1)).toEqual({
      path: "shop",
      checkpoint: true
    });
    await stopRunner(harness.ctx);
  });

  it("names a node, not a rest node, when the bookmark's path is gone from the graph", async () => {
    const main = flow("main", { home: waiting("play") }, "home", { home: { play: "home" } });
    const harness = setup({ main });
    const running = harness.start();
    const bookmark: Bookmark = {
      path: "gone",
      input: {},
      player: {},
      session: {},
      rng: { seed: 2, streams: {} },
      graph: "deadbeef"
    };

    await tick();
    restorePosition(harness.ctx, harness.modules, bookmark).catch(() => undefined);

    await expect(running).rejects.toThrow(
      '[game] The bookmark names no node "gone".\n  Bookmark a node of the running graph.'
    );
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
