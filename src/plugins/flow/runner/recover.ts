/**
 * @file flow/runner — the recovery turn. When the loop gave up on a transition it stands on the
 * safe node with the state of the rest point that failed. A safe node with `recover` puts that
 * state right first, as one committed edge, so its gate never opens on it.
 */
import type { FlowCtx } from "../types";
import { arrive, commitEdge, handleAbort, handleFailure } from "./edge";
import type { RecoveryOutcome, Safe, Step, StepOutcome } from "./loop-types";
import { noPayload } from "./loop-types";
import { abortOutcome, abortReason, nodeFx, stopped } from "./node";
import { notifyGateOpen } from "./seam";
import type { AnyNode, AnyRecoverContext, Modules } from "./types";

/** One recovery in progress: a node run that has no input. */
type Recovery = Omit<Step, "abort" | "input">;

/** The safe node the loop stands on: what `runNode` knows when it starts a recovery. */
type Place = Pick<Step, "location" | "node" | "path">;

/**
 * Takes the recovery the loop owes the safe node. It is owed once per give-up, to the first node
 * entered after it, and a node without `recover` uses it up as well.
 *
 * @param safe - How the loop stands after it gave up.
 * @param node - The node being entered.
 * @returns True when the node has a `recover` that must run now.
 */
export function takeRecovery(safe: Safe, node: AnyNode): boolean {
  if (!safe.recover) return false;

  safe.recover = false;

  return node.recover !== undefined;
}

/**
 * Builds the one object a `recover` receives: the node context without `input` and `out`.
 *
 * @param modules - Injected sibling APIs.
 * @param recovery - The recovery in progress.
 * @returns The recovery context.
 */
function recoverContext(modules: Modules, recovery: Recovery): AnyRecoverContext {
  return {
    player: recovery.transaction.player,
    session: recovery.transaction.session,
    rng: recovery.transaction.rng,
    fx: nodeFx(modules, recovery),
    signal: recovery.signal,
    now: recovery.now
  };
}

/**
 * Calls the `recover` of a node and turns what it does into an outcome. Nothing is thrown out of
 * here.
 *
 * @param modules - Injected sibling APIs.
 * @param recovery - The recovery in progress.
 * @returns That it returned, the abort or the failure.
 */
async function callRecover(modules: Modules, recovery: Recovery): Promise<RecoveryOutcome> {
  try {
    await recovery.node.recover?.(recoverContext(modules, recovery));

    if (recovery.signal.aborted) return { kind: "aborted", reason: abortReason(recovery.signal) };

    return { kind: "recovered" };
  } catch (error) {
    if (recovery.signal.aborted) return { kind: "aborted", reason: abortReason(recovery.signal) };

    return { kind: "failed", error };
  }
}

/**
 * Takes the recovery edge: what `recover` wrote is committed as an edge of the safe node onto
 * itself, with the outcome `"recover"`, and the node becomes the rest point. The journal entry,
 * `flow:edge`, the rest mark of the store and `flow:rest` are the ones of any edge into a rest
 * node, so a later rollback returns to the recovered state.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param recovery - The recovery whose `recover` returned.
 */
function commitRecovery(ctx: FlowCtx, modules: Modules, recovery: Recovery): void {
  commitEdge(
    ctx,
    modules,
    {
      location: recovery.location,
      transaction: recovery.transaction,
      result: { outcome: "recover", payload: noPayload },
      barrier: false,
      now: recovery.now,
      path: recovery.path
    },
    recovery.path
  );
  ctx.deps.model.store.markRest();
  arrive(ctx, {
    stack: [...ctx.state.runner.stack],
    next: recovery.path,
    rest: true,
    checkpoint: recovery.node.checkpoint
  });
}

/**
 * Runs the `recover` of the safe node as one transaction, before the node is entered: an abort
 * controller of its own, an open transaction, `recover` raced against the abort, then the
 * recovery edge. A `recover` that fails is a failure inside the safe node: fatal, `run()` rejects.
 * An aborted one leaves like an aborted node: `"stop"` ends the loop, `"restore"` lets the next
 * turn enter the bookmark. `safe.inside` is not touched: it stays true until the safe node's own
 * edge commits or a restore leaves the node, so a failure of the safe node after its recovery is
 * still fatal, never a loop.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param place - The safe node the loop stands on.
 * @param safe - How the loop stands after it gave up.
 * @returns The outcome that ends this turn, or `undefined` when the node is entered now.
 * @throws {Error} When `recover` failed.
 */
export async function recoverNode(
  ctx: FlowCtx,
  modules: Modules,
  place: Place,
  safe: Safe
): Promise<StepOutcome | undefined> {
  const state = ctx.state.runner;
  const abort = new AbortController();

  state.abort = abort;

  const recovery: Recovery = {
    ...place,
    transaction: ctx.deps.model.store.begin(),
    signal: abort.signal,
    now: ctx.deps.clock.now(),
    /**
     * Tells a walk that the recovery opened the gate for an answer.
     */
    gateOpened: (): void => {
      notifyGateOpen(state);
    }
  };
  const outcome = await Promise.race([callRecover(modules, recovery), abortOutcome(abort.signal)]);

  // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts a running guide.
  modules.gate.narrow(undefined);
  // A guide of the recovery ends where the recovery ends, as it does for a node.
  modules.fx.endGuides();

  if (outcome.kind === "failed") {
    return handleFailure(ctx, modules, recovery.transaction, outcome.error, place.path, safe);
  }

  if (outcome.kind === "aborted") return handleAbort(modules, recovery.transaction, outcome.reason);

  commitRecovery(ctx, modules, recovery);

  // A stop or a restore that landed while the recovery settled was aimed at this controller. The
  // node must not be entered over it: its own controller would overwrite the stop on record.
  if (stopped(state)) return "stop";
  if (state.seam?.restoring !== undefined) return "continue";

  return undefined;
}
