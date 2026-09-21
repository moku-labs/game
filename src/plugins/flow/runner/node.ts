/**
 * @file flow/runner — the node context and running one node.
 */
import type { Json } from "../../model/types";
import type { Descriptor, Hint, NodeFx } from "../fx/types";
import type { Allow } from "../gate/types";
import type { FlowCtx } from "../types";
import { createOut } from "./define";
import type { AbortReason, Delivery, Location, NodeOutcome, Step } from "./loop-types";
import { noop, stages } from "./loop-types";
import { answerResult, eventResult } from "./position";
import type { AnyNode, AnyNodeContext, Modules, NodeInfo, RunnerState } from "./types";

/**
 * Tells whether a JSON value is an object with keys: not `null`, not an array.
 *
 * @param value - Any JSON value.
 * @returns `true` for a plain object.
 * @example
 * ```ts
 * if (isPlainRecord(payload)) read(payload.allow);
 * ```
 */
function isPlainRecord(value: Json | undefined): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the one answer a `guide` descriptor lets through.
 *
 * @param payload - Payload of the descriptor, as JSON.
 * @returns The allowed answer, or `undefined` when the payload names none.
 * @example
 * ```ts
 * const allow = guideAllow({ allow: { intent: "merge" } });
 * ```
 */
function guideAllow(payload: Json | undefined): Allow | undefined {
  if (!isPlainRecord(payload)) return undefined;

  const allow = payload.allow;

  if (!isPlainRecord(allow)) return undefined;

  const intent = allow.intent;

  if (typeof intent !== "string") return undefined;

  return allow.payload === undefined ? { intent } : { intent, payload: allow.payload };
}

/**
 * Builds the `fx` of a node context: awaited effects by call, cosmetic hints by `emit`. A `guide`
 * narrows the gate while it runs; the runner lifts the narrow when the node is left.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The effects gateway of one node run.
 * @example
 * ```ts
 * const fx = nodeFx(modules, step);
 * ```
 */
function nodeFx(modules: Modules, step: Step): NodeFx {
  /**
   * Awaits one effect.
   *
   * @param descriptor - The descriptor the node awaits.
   * @returns The answer, the handler's value, or `undefined`.
   * @example
   * ```ts
   * const answer = await fx(popup);
   * ```
   */
  const run = (descriptor: Descriptor): Promise<unknown> => {
    if (descriptor.kind === "guide") {
      const allow = guideAllow(descriptor.payload);

      if (allow !== undefined) modules.gate.narrow(allow);
    }

    const value = modules.fx.run(descriptor, step.signal);

    if (descriptor.answers !== undefined) step.gateOpened();

    return value;
  };

  return Object.assign(run, {
    /**
     * Buffers one cosmetic hint until the transaction of this node commits.
     *
     * @param item - The hint.
     * @example
     * ```ts
     * fx.emit(hint("sparkle", { cell: "c3" }));
     * ```
     */
    emit: (item: Hint): void => {
      modules.fx.buffer(item);
    }
  });
}

/**
 * Builds the one object a node body receives.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The node context.
 * @example
 * ```ts
 * const context = nodeContext(modules, step);
 * ```
 */
function nodeContext(modules: Modules, step: Step): AnyNodeContext {
  return {
    input: step.input,
    player: step.transaction.player,
    session: step.transaction.session,
    rng: step.transaction.rng,
    fx: nodeFx(modules, step),
    out: createOut(step.node.outcomes),
    signal: step.signal,
    now: step.now
  };
}

/**
 * Describes the node being entered for the `onEnter` callbacks.
 *
 * @param path - Runtime path of the node.
 * @param location - Where the node sits in the graph.
 * @param node - The node itself.
 * @returns What an `onEnter` callback learns.
 * @example
 * ```ts
 * await runEnterCallbacks(ctx, nodeInfo(path, location, node), signal);
 * ```
 */
export function nodeInfo(path: string, location: Location, node: AnyNode): NodeInfo {
  return {
    path,
    flow: location.flow.id,
    node: location.name,
    rest: node.rest,
    over: node.over,
    checkpoint: node.checkpoint,
    barrier: node.barrier
  };
}

/**
 * Runs the `onEnter` callbacks stage by stage, registration order inside a stage, each awaited.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param info - The node being entered.
 * @param signal - The node's abort signal.
 * @example
 * ```ts
 * await runEnterCallbacks(ctx, info, signal);
 * ```
 */
export async function runEnterCallbacks(
  ctx: FlowCtx,
  info: NodeInfo,
  signal: AbortSignal
): Promise<void> {
  const mode = ctx.state.fx.mode;

  for (const stage of stages) {
    const callbacks = [...ctx.state.runner.enterCallbacks[stage]];

    for (const callback of callbacks) {
      await callback(info, { mode, signal });
    }
  }
}

// ─── running one node ─────────────────────────────────────────

/**
 * Reads the reason the active node was aborted with. Anything unexpected counts as `"stop"`.
 *
 * @param signal - The aborted signal.
 * @returns The reason the runner set.
 * @example
 * ```ts
 * const reason = abortReason(step.signal);
 * ```
 */
export function abortReason(signal: AbortSignal): AbortReason {
  const reason: unknown = signal.reason;

  if (reason === "inbox" || reason === "restore") return reason;

  return "stop";
}

/**
 * Tells whether the runner was stopped. The abort of `onStop` survives between two nodes, so a
 * loop that is not inside a node ends at the next turn.
 *
 * @param state - Runner state.
 * @returns True once `stopRunner` aborted.
 * @example
 * ```ts
 * if (stopped(state)) return "stop";
 * ```
 */
export function stopped(state: RunnerState): boolean {
  const signal = state.abort?.signal;

  if (signal === undefined || !signal.aborted) return false;

  return abortReason(signal) === "stop";
}

/**
 * Resolves as soon as the node is aborted, so a body that ignores its signal never holds the loop.
 *
 * @param signal - The node's abort signal.
 * @returns The abort outcome.
 * @example
 * ```ts
 * const outcome = await Promise.race([body, abortOutcome(signal)]);
 * ```
 */
function abortOutcome(signal: AbortSignal): Promise<NodeOutcome> {
  if (signal.aborted) return Promise.resolve({ kind: "aborted", reason: abortReason(signal) });

  return new Promise<NodeOutcome>(resolve => {
    signal.addEventListener(
      "abort",
      () => {
        resolve({ kind: "aborted", reason: abortReason(signal) });
      },
      { once: true }
    );
  });
}

/**
 * Calls the body of a node and turns what it does into an outcome. Nothing is thrown out of here.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The result, the abort or the failure.
 * @example
 * ```ts
 * const outcome = await callBody(modules, step);
 * ```
 */
async function callBody(modules: Modules, step: Step): Promise<NodeOutcome> {
  try {
    const result = await step.node.run?.(nodeContext(modules, step));

    if (step.signal.aborted) return { kind: "aborted", reason: abortReason(step.signal) };

    if (result === undefined) {
      return {
        kind: "failed",
        error: new Error(
          `[game] The node "${step.path}" returned nothing.\n  End the body with out.<outcome>().`
        )
      };
    }

    return { kind: "result", result };
  } catch (error) {
    if (step.signal.aborted) return { kind: "aborted", reason: abortReason(step.signal) };

    return { kind: "failed", error };
  }
}

/**
 * Runs a node body against its abort signal.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The outcome of the body or of the abort, whichever comes first.
 * @example
 * ```ts
 * const outcome = await runBody(modules, step);
 * ```
 */
function runBody(modules: Modules, step: Step): Promise<NodeOutcome> {
  return Promise.race([callBody(modules, step), abortOutcome(step.signal)]);
}

/**
 * Runs the body of a rest node while the inbox watches for a deliverable world event. Such an
 * event aborts the node with reason `"inbox"`: not an error and not a retry.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param delivered - Holder of the event the inbox delivered.
 * @returns The outcome of the body, or the delivered event.
 * @example
 * ```ts
 * const outcome = await runRestBody(modules, step, delivered);
 * ```
 */
async function runRestBody(
  modules: Modules,
  step: Step,
  delivered: Delivery
): Promise<NodeOutcome> {
  /**
   * Looks for a deliverable event and aborts the node when one is there.
   *
   * @example
   * ```ts
   * check();
   * ```
   */
  const check = (): void => {
    if (delivered.event !== undefined) return;

    const event = modules.inbox.take(step.node.inbox);

    if (event === undefined) return;

    delivered.event = event;
    step.abort.abort("inbox");
  };
  const off = modules.inbox.onPost(check);

  check();

  try {
    const outcome = await runBody(modules, step);
    const event = delivered.event;

    if (outcome.kind === "aborted" && outcome.reason === "inbox" && event !== undefined) {
      return { kind: "event", event };
    }

    return outcome;
  } finally {
    off();
  }
}

/**
 * Waits at a rest node without a body: the gate answer whose intent names an outcome wins, and so
 * does a world event the node lists in its `inbox`. A node whose signal is already aborted — a stop
 * or a restore that arrived while the `onEnter` callbacks ran — never opens the gate.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The outcome the player or the world produced.
 * @example
 * ```ts
 * const outcome = await waitForAnswer(modules, step);
 * ```
 */
function waitForAnswer(modules: Modules, step: Step): Promise<NodeOutcome> {
  if (step.signal.aborted) {
    return Promise.resolve({ kind: "aborted", reason: abortReason(step.signal) });
  }

  const queued = modules.inbox.take(step.node.inbox);

  if (queued !== undefined) return Promise.resolve({ kind: "result", result: eventResult(queued) });

  return new Promise<NodeOutcome>(resolve => {
    const race: { done: boolean; off: () => void } = { done: false, off: noop };
    /**
     * Ends the wait once, whoever answered first.
     *
     * @param outcome - What ended the wait.
     * @example
     * ```ts
     * finish({ kind: "result", result });
     * ```
     */
    const finish = (outcome: NodeOutcome): void => {
      if (race.done) return;

      race.done = true;
      race.off();
      modules.gate.close();
      resolve(outcome);
    };

    race.off = modules.inbox.onPost(() => {
      const event = modules.inbox.take(step.node.inbox);

      if (event !== undefined) finish({ kind: "result", result: eventResult(event) });
    });

    step.signal.addEventListener(
      "abort",
      () => {
        finish({ kind: "aborted", reason: abortReason(step.signal) });
      },
      { once: true }
    );

    const answered = modules.gate.open({ allowed: Object.keys(step.node.outcomes) });

    step.gateOpened();
    answered.then(
      answer => {
        finish({ kind: "result", result: answerResult(answer) });
      },
      (error: unknown) => {
        finish({ kind: "failed", error });
      }
    );
  });
}

/**
 * Produces the outcome of one node: a pure wait, a rest node with a body, or a transit node.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param delivered - Holder of the event the inbox delivered.
 * @returns The outcome of that node.
 * @example
 * ```ts
 * const outcome = await nodeOutcome(modules, step, delivered);
 * ```
 */
export function nodeOutcome(
  modules: Modules,
  step: Step,
  delivered: Delivery
): Promise<NodeOutcome> {
  if (step.node.run === undefined) return waitForAnswer(modules, step);
  if (step.node.rest) return runRestBody(modules, step, delivered);

  return runBody(modules, step);
}

/**
 * Waits while a pointer is down, so an `over` node never appears mid-drag. Without a running frame
 * loop nothing would ever wake the wait, so the node is entered at once. A stop ends the wait as
 * well: the runner must not hold the loop open for a pointer that is never lifted.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns A promise that resolves when the pointer is up or the runner was stopped.
 * @example
 * ```ts
 * if (node.over) await waitForPointer(ctx);
 * ```
 */
export function waitForPointer(ctx: FlowCtx): Promise<void> {
  if (!ctx.state.gate.pointerActive) return Promise.resolve();
  if (!ctx.deps.time.isRunning()) return Promise.resolve();

  return new Promise<void>(resolve => {
    const watch: { off: () => void } = { off: noop };
    /**
     * Ends the wait: drops the frame callback and resolves.
     *
     * @example
     * ```ts
     * ctx.state.gate.wake?.();
     * ```
     */
    const wake = (): void => {
      watch.off();
      ctx.state.gate.wake = undefined;
      resolve();
    };

    // A stop calls `wake` itself: a paused clock runs no frame that could end the wait.
    ctx.state.gate.wake = wake;
    watch.off = ctx.deps.time.onFrame("signals", () => {
      if (!ctx.state.gate.pointerActive) wake();
    });
  });
}
