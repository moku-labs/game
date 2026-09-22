/**
 * @file flow/fx — API factory. The gateway between node logic and everything that is not logic.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Answer, GateInternal } from "../gate/types";
import type { FlowCtx } from "../types";
import type {
  Descriptor,
  FxApi,
  FxHandler,
  FxInternal,
  FxState,
  Hint,
  HintListener
} from "./types";

/** One registered handler with its fast-mode flag. */
type HandlerEntry = { run: FxHandler; runInFast: boolean };

/** A completion waiting for the `signals` phase. `ready` turns true when the effect settled. */
type Pending = { ready: boolean; value: unknown; failure: Error | undefined };

/**
 * Turns whatever an effect handler or a hint listener failed with into an error the log takes.
 *
 * @param error - The thrown value or the rejection reason.
 * @returns The value itself when it is an error, its text otherwise.
 * @example
 * ```ts
 * asError("no audio device").message; // "no audio device"
 * ```
 */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Logs a handler failure. An effect handler lives above the graph, so its failure is never the
 * logic's problem: fire-and-forget delivery and the UI part of an answered effect only log.
 *
 * @param log - The engine log.
 * @param kind - Effect kind whose handler failed.
 * @param error - What the handler threw or rejected with.
 */
function reportFailure(log: Log.LogApi, kind: string, error: unknown): void {
  log.error("flow:fx-handler-failed", { kind }, asError(error));
}

/**
 * Hands one released hint to every `onHint` listener, in registration order. A listener lives
 * above the graph and the hint is out after the commit, so a failing listener is logged and the
 * next one is still served.
 *
 * @param state - fx module state.
 * @param log - The engine log.
 * @param item - The hint that was just released.
 */
function notifyHint(state: FxState, log: Log.LogApi, item: Hint): void {
  // A copy: a listener that removes itself while it runs must not make the loop skip the next one.
  const listeners = [...state.hintListeners];

  for (const listener of listeners) {
    try {
      listener(item);
    } catch (error) {
      log.error("flow:hint-listener-failed", { kind: item.kind }, asError(error));
    }
  }
}

/**
 * Reads the handler that may run for a kind in the current mode. In fast mode only handlers
 * registered with `runInFast` run, so a fast walk never waits for a sound or an animation.
 *
 * @param state - fx module state.
 * @param kind - Effect kind of the descriptor.
 * @returns The handler entry, or `undefined` when nothing runs.
 */
function handlerFor(state: FxState, kind: string): HandlerEntry | undefined {
  const entry = state.handlers.get(kind);

  if (entry === undefined) return;
  if (state.mode === "fast" && !entry.runInFast) return;

  return entry;
}

/**
 * Calls the handler of a descriptor without waiting for it. The mode decides the same way it does
 * for an awaited effect: in fast mode only a `runInFast` handler runs. A thrown error and a
 * rejected promise are logged, never handed to the caller.
 *
 * @param state - fx module state.
 * @param log - The engine log.
 * @param descriptor - The descriptor or hint to deliver.
 * @param signal - Abort signal handed to the handler.
 */
function invoke(
  state: FxState,
  log: Log.LogApi,
  descriptor: Descriptor | Hint,
  signal: AbortSignal
): void {
  const entry = handlerFor(state, descriptor.kind);

  if (entry === undefined) return;

  try {
    const result = entry.run(descriptor, { signal, mode: state.mode });

    Promise.resolve(result).catch((error: unknown) => {
      reportFailure(log, descriptor.kind, error);
    });
  } catch (error) {
    reportFailure(log, descriptor.kind, error);
  }
}

/**
 * Runs the handler of an awaited effect. A missing handler resolves `undefined` instantly, so a
 * game without `audio` runs; a `cosmetic` descriptor swallows the failure the same way.
 *
 * @param state - fx module state.
 * @param descriptor - The awaited descriptor.
 * @param signal - The node's abort signal.
 * @returns What the handler resolved with.
 */
async function effectValue(
  state: FxState,
  descriptor: Descriptor,
  signal: AbortSignal
): Promise<unknown> {
  const entry = handlerFor(state, descriptor.kind);

  if (entry === undefined) return;

  try {
    return await entry.run(descriptor, { signal, mode: state.mode });
  } catch (error) {
    if (descriptor.cosmetic === true) return;

    throw error;
  }
}

/**
 * Queues a completion for the `signals` phase. The slot is taken when the effect STARTS, so two
 * effects that end in one frame always resume in the order they were started. The queued entry
 * removes itself from the queue when it fires.
 *
 * @param state - fx module state.
 * @param work - The promise of the running effect.
 * @returns A promise that settles in the next `signals` phase after `work` settled.
 */
function enqueue(state: FxState, work: Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const pending: Pending = { ready: false, value: undefined, failure: undefined };

    /**
     * Settles this completion in the `signals` phase. An effect that has not ended yet goes back
     * into the queue in front of everything started later, so start order survives a flush.
     */
    const entry = (): void => {
      if (!pending.ready) {
        state.settled.push(entry);
        return;
      }

      if (pending.failure === undefined) resolve(pending.value);
      else reject(pending.failure);
    };

    state.settled.push(entry);
    work.then(
      value => {
        pending.value = value;
        pending.ready = true;
      },
      (error: unknown) => {
        pending.failure = error instanceof Error ? error : new Error(String(error));
        pending.ready = true;
      }
    );
  });
}

/**
 * Derives the signal one handler gets: a child of the node's signal that the gateway can end on
 * its own. The node's abort reaches the child with its reason; what the child does never reaches
 * the node. The forwarding listener is dropped with the child, so a node that shows many popups
 * leaves nothing behind on its signal.
 *
 * @param signal - The node's abort signal.
 * @returns The controller of the child signal.
 */
function childOf(signal: AbortSignal): AbortController {
  const child = new AbortController();

  if (signal.aborted) {
    child.abort(signal.reason);

    return child;
  }

  signal.addEventListener(
    "abort",
    () => {
      child.abort(signal.reason);
    },
    { once: true, signal: child.signal }
  );

  return child;
}

/**
 * Starts the signal of a `guide` handler and records it, so the runner can end every guide where
 * it lifts the narrow. A guide the node's abort already ended takes itself off the list.
 *
 * @param state - fx module state.
 * @param signal - The node's abort signal.
 * @returns The signal the guide handler is called with.
 */
function beginGuide(state: FxState, signal: AbortSignal): AbortSignal {
  const child = childOf(signal);

  state.guides.push(child);
  child.signal.addEventListener(
    "abort",
    () => {
      const index = state.guides.indexOf(child);

      if (index !== -1) state.guides.splice(index, 1);
    },
    { once: true }
  );

  return child.signal;
}

/**
 * Opens the gate for a descriptor that carries `answers` and resolves with the player's answer in
 * both modes. In live mode the handler is called as well: it only shows the UI, the answer comes
 * through the gate, so its failure is logged and does not block the node. Its signal ends with the
 * answer — that is how the popup layer knows to unmount what it showed.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param gate - Internal gate API.
 * @param descriptor - The awaited descriptor.
 * @param answers - Intents the gate accepts while the effect runs.
 * @param signal - The node's abort signal.
 * @returns The answer the gate accepted.
 */
function openForAnswers(
  ctx: FlowCtx,
  gate: GateInternal,
  descriptor: Descriptor,
  answers: readonly string[],
  signal: AbortSignal
): Promise<Answer> {
  const answered = gate.open({ allowed: answers });

  if (ctx.state.fx.mode !== "live") return answered;

  const shown = childOf(signal);

  invoke(ctx.state.fx, ctx.log, descriptor, shown.signal);

  return answered.finally(() => {
    shown.abort();
  });
}

/**
 * Creates the effects gateway: `handle` registers one handler per kind, `dispatch` delivers
 * fire-and-forget, `onHint` listens to the released hints, the internal `run` awaits a descriptor
 * (through the gate when it has `answers`), hints are buffered with the transaction and released
 * after its commit, and completions resolve in start order in the `signals` phase.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param deps - Injected sibling APIs.
 * @param deps.gate - Internal gate API: opens the gate for a descriptor with `answers`.
 * @returns The public fx API plus the methods injected into the runner.
 */
export function createFxApi(ctx: FlowCtx, deps: { gate: GateInternal }): FxApi & FxInternal {
  const state = ctx.state.fx;

  return {
    handle: (kind: string, handler: FxHandler, options?: { runInFast?: boolean }): (() => void) => {
      if (state.handlers.has(kind)) {
        throw new Error(
          `[game] Effect kind "${kind}" already has a handler.\n  Unregister the first handler before adding another.`
        );
      }

      const entry: HandlerEntry = { run: handler, runInFast: options?.runInFast ?? false };

      state.handlers.set(kind, entry);

      return () => {
        if (state.handlers.get(kind) === entry) state.handlers.delete(kind);
      };
    },

    dispatch: (descriptor: Descriptor | Hint): void => {
      invoke(state, ctx.log, descriptor, new AbortController().signal);
    },

    onHint: (listener: HintListener): (() => void) => {
      /**
       * Calls the listener. The wrapper is this registration's identity, so the remover below
       * removes this one and never another registration of the same function.
       *
       * @param item - The released hint.
       */
      const entry: HintListener = (item: Hint): void => {
        listener(item);
      };

      state.hintListeners.push(entry);

      return () => {
        const index = state.hintListeners.indexOf(entry);

        if (index !== -1) state.hintListeners.splice(index, 1);
      };
    },

    run: (descriptor: Descriptor, signal: AbortSignal): Promise<unknown> => {
      const answers = descriptor.answers;

      if (answers !== undefined) return openForAnswers(ctx, deps.gate, descriptor, answers, signal);

      // A guide outlives its own `await`: it keeps the narrow and its visual until the node ends,
      // so its handler gets a signal of its own instead of the node's.
      const shown = descriptor.kind === "guide" ? beginGuide(state, signal) : signal;
      const work = effectValue(state, descriptor, shown);

      if (state.mode === "fast" || !ctx.deps.time.isRunning()) return work;

      return enqueue(state, work);
    },

    buffer: (item: Hint): void => {
      if (state.mode === "fast") return;

      state.buffered.push(item);
    },

    release: (): void => {
      const hints = [...state.buffered];

      state.buffered.length = 0;
      for (const item of hints) {
        invoke(state, ctx.log, item, new AbortController().signal);
        notifyHint(state, ctx.log, item);
      }
    },

    drop: (): void => {
      state.buffered.length = 0;
    },

    flushSettled: (): void => {
      if (state.settled.length === 0) return;

      const drained = state.settled;

      state.settled = [];
      for (const entry of drained) entry();
    },

    endGuides: (): void => {
      const shown = [...state.guides];

      state.guides.length = 0;
      for (const controller of shown) controller.abort();
    },

    setMode: (mode: "live" | "fast"): void => {
      state.mode = mode;
    }
  };
}
