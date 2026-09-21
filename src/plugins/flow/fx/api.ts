/**
 * @file flow/fx — API factory. The gateway between node logic and everything that is not logic.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Answer, GateInternal } from "../gate/types";
import type { FlowCtx } from "../types";
import type { Descriptor, FxApi, FxHandler, FxInternal, FxState, Hint } from "./types";

/** One registered handler with its fast-mode flag. */
type HandlerEntry = { run: FxHandler; runInFast: boolean };

/** A completion waiting for the `signals` phase. `ready` turns true when the effect settled. */
type Pending = { ready: boolean; value: unknown; failure: Error | undefined };

/**
 * Logs a handler failure. An effect handler lives above the graph, so its failure is never the
 * logic's problem: fire-and-forget delivery and the UI part of an answered effect only log.
 *
 * @param log - The engine log.
 * @param kind - Effect kind whose handler failed.
 * @param error - What the handler threw or rejected with.
 * @example
 * ```ts
 * reportFailure(ctx.log, "sfx", error);
 * ```
 */
function reportFailure(log: Log.LogApi, kind: string, error: unknown): void {
  log.error(
    "flow:fx-handler-failed",
    { kind },
    error instanceof Error ? error : new Error(String(error))
  );
}

/**
 * Reads the handler that may run for a kind in the current mode. In fast mode only handlers
 * registered with `runInFast` run, so a fast walk never waits for a sound or an animation.
 *
 * @param state - fx module state.
 * @param kind - Effect kind of the descriptor.
 * @returns The handler entry, or `undefined` when nothing runs.
 * @example
 * ```ts
 * const entry = handlerFor(ctx.state.fx, descriptor.kind);
 * ```
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
 * @example
 * ```ts
 * invoke(ctx.state.fx, ctx.log, hint("sparkle"), signal);
 * ```
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
 * @example
 * ```ts
 * const value = await effectValue(ctx.state.fx, descriptor, signal);
 * ```
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
 * @example
 * ```ts
 * return enqueue(ctx.state.fx, effectValue(ctx.state.fx, descriptor, signal));
 * ```
 */
function enqueue(state: FxState, work: Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const pending: Pending = { ready: false, value: undefined, failure: undefined };

    /**
     * Settles this completion in the `signals` phase. An effect that has not ended yet goes back
     * into the queue in front of everything started later, so start order survives a flush.
     *
     * @example
     * ```ts
     * for (const queued of drained) queued();
     * ```
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
 * Opens the gate for a descriptor that carries `answers` and resolves with the player's answer in
 * both modes. In live mode the handler is called as well: it only shows the UI, the answer comes
 * through the gate, so its failure is logged and does not block the node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param gate - Internal gate API.
 * @param descriptor - The awaited descriptor.
 * @param answers - Intents the gate accepts while the effect runs.
 * @param signal - The node's abort signal.
 * @returns The answer the gate accepted.
 * @example
 * ```ts
 * const answer = await openForAnswers(ctx, gate, descriptor, descriptor.answers, signal);
 * ```
 */
function openForAnswers(
  ctx: FlowCtx,
  gate: GateInternal,
  descriptor: Descriptor,
  answers: readonly string[],
  signal: AbortSignal
): Promise<Answer> {
  const answered = gate.open({ allowed: answers });

  if (ctx.state.fx.mode === "live") invoke(ctx.state.fx, ctx.log, descriptor, signal);

  return answered;
}

/**
 * Creates the effects gateway: `handle` registers one handler per kind, `dispatch` delivers
 * fire-and-forget, the internal `run` awaits a descriptor (through the gate when it has
 * `answers`), hints are buffered with the transaction and released after its commit, and
 * completions resolve in start order in the `signals` phase.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param deps - Injected sibling APIs.
 * @param deps.gate - Internal gate API: opens the gate for a descriptor with `answers`.
 * @returns The public fx API plus the methods injected into the runner.
 * @example
 * ```ts
 * const fx = createFxApi(ctx, { gate });
 * const off = fx.handle("sfx", playSound);
 * ```
 */
export function createFxApi(ctx: FlowCtx, deps: { gate: GateInternal }): FxApi & FxInternal {
  const state = ctx.state.fx;

  return {
    /**
     * Registers the single handler of one effect kind. A second handler for the same kind throws:
     * an effect has exactly one owner.
     *
     * @param kind - Effect kind, for example `"sfx"`.
     * @param handler - Called with the descriptor and `{ signal, mode }`.
     * @param options - Registration options.
     * @param options.runInFast - `true` makes the handler run in fast mode too.
     * @returns The unregister function. It removes only the handler it registered.
     * @throws {Error} When the kind already has a handler.
     * @example
     * ```ts
     * const off = app.flow.fx.handle("load", preload, { runInFast: true });
     * ```
     */
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

    /**
     * Delivers a descriptor or a released hint to its handler and forgets about it. In fast mode
     * only a handler registered with `runInFast` is called, exactly as for an awaited effect. A
     * missing handler is not an error and a failing handler is logged, never thrown.
     *
     * @param descriptor - The descriptor or hint to deliver.
     * @example
     * ```ts
     * app.flow.fx.dispatch({ kind: "haptic", payload: { style: "light" } });
     * ```
     */
    dispatch: (descriptor: Descriptor | Hint): void => {
      invoke(state, ctx.log, descriptor, new AbortController().signal);
    },

    /**
     * Runs one awaited effect. With `answers` the gate decides; without it the handler does, and
     * while the frame loop runs the completion waits for the next `signals` phase.
     *
     * @param descriptor - The descriptor the node awaits.
     * @param signal - The node's abort signal, handed to the handler.
     * @returns The answer, the handler's value, or `undefined`.
     * @example
     * ```ts
     * const answer = await modules.fx.run(popup, signal);
     * ```
     */
    run: (descriptor: Descriptor, signal: AbortSignal): Promise<unknown> => {
      const answers = descriptor.answers;

      if (answers !== undefined) return openForAnswers(ctx, deps.gate, descriptor, answers, signal);

      const work = effectValue(state, descriptor, signal);

      if (state.mode === "fast" || !ctx.deps.time.isRunning()) return work;

      return enqueue(state, work);
    },

    /**
     * Buffers one hint of the open transaction. In fast mode the hint is dropped: a fast walk
     * shows nothing.
     *
     * @param item - The hint produced by `fx.emit`.
     * @example
     * ```ts
     * modules.fx.buffer(hint("sparkle", { cell: "c3" }));
     * ```
     */
    buffer: (item: Hint): void => {
      if (state.mode === "fast") return;

      state.buffered.push(item);
    },

    /**
     * Dispatches the buffered hints in the order they were emitted and empties the buffer. Called
     * after the commit of the transaction they belong to.
     *
     * @example
     * ```ts
     * transaction.commit();
     * modules.fx.release();
     * ```
     */
    release: (): void => {
      const hints = [...state.buffered];

      state.buffered.length = 0;
      for (const item of hints) invoke(state, ctx.log, item, new AbortController().signal);
    },

    /**
     * Drops the buffered hints of a discarded transaction. Nothing the player would have seen for
     * a change that never happened is shown.
     *
     * @example
     * ```ts
     * transaction.discard();
     * modules.fx.drop();
     * ```
     */
    drop: (): void => {
      state.buffered.length = 0;
    },

    /**
     * Resolves every effect that settled since the last frame, in the order the effects were
     * started. Wired to `time.onFrame("signals")` by the plugin root.
     *
     * @example
     * ```ts
     * time.onFrame("signals", () => modules.fx.flushSettled());
     * ```
     */
    flushSettled: (): void => {
      if (state.settled.length === 0) return;

      const drained = state.settled;

      state.settled = [];
      for (const entry of drained) entry();
    },

    /**
     * Switches between live and fast mode. `walk` and `createHeadless` use it.
     *
     * @param mode - `"live"` runs the handlers, `"fast"` skips all but `runInFast`.
     * @example
     * ```ts
     * modules.fx.setMode("fast");
     * ```
     */
    setMode: (mode: "live" | "fast"): void => {
      state.mode = mode;
    }
  };
}
