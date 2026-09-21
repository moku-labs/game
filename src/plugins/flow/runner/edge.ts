/**
 * @file flow/runner — taking the edge. The only place that calls `transaction.commit()`: state
 * changes on the edge, never inside a node.
 */
import type { Transaction } from "../../model/types";
import type { FlowCtx } from "../types";
import { compact, pushEntry } from "./journal";
import type { AbortReason, Arrival, Commit, Location, Safe, StepOutcome } from "./loop-types";
import { planFrom } from "./plan";
import { safeFrames } from "./position";
import { framePath } from "./registry";
import { notifyRest } from "./seam";
import type { Frame, JournalEntry, Modules, Result } from "./types";

/**
 * Commits the transaction of one node, releases its hints, journals the edge and emits
 * `flow:edge`. This is the only commit of the engine.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The result ready to be committed.
 * @param next - Path the edge leads to.
 * @returns The journal entry of this edge.
 */
function commitEdge(ctx: FlowCtx, modules: Modules, step: Commit, next: string): JournalEntry {
  const commit = step.transaction.commit();

  modules.fx.release();

  const entry = pushEntry(
    ctx.state.runner,
    {
      path: step.path,
      outcome: step.result.outcome,
      payload: step.result.payload,
      next,
      now: step.now
    },
    ctx.config.journalLimit
  );

  ctx.emit("flow:edge", {
    flow: step.location.flow.id,
    node: step.location.name,
    outcome: step.result.outcome,
    payload: step.result.payload,
    next,
    patches: commit.patches,
    index: entry.index,
    now: step.now
  });

  return entry;
}

/**
 * Discards everything the failed node did, rolls back and decides between a retry and the safe
 * node. A failure while the loop already recovers in the safe node is fatal.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param transaction - The open transaction, when the node got that far.
 * @param error - What the node failed with.
 * @param path - Path of the failed node.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`: the loop re-enters a position.
 * @throws {Error} When the safe node itself failed.
 */
export function handleFailure(
  ctx: FlowCtx,
  modules: Modules,
  transaction: Transaction | undefined,
  error: unknown,
  path: string,
  safe: Safe
): StepOutcome {
  const state = ctx.state.runner;

  transaction?.discard();
  modules.fx.drop();
  modules.gate.close();
  ctx.deps.model.store.rollback();

  if (safe.inside) {
    throw new Error(
      `[game] The node "${path}" failed while the graph was recovering in the safe node.\n  Fix the node or point flow.safeNode at a checkpoint that cannot fail.`,
      { cause: error }
    );
  }

  state.failures += 1;

  const retry = state.failures <= ctx.config.retries;
  const safeTarget = (): Frame[] => safeFrames(ctx, modules.features.contributions);
  const target = retry ? (state.restFrame ?? safeTarget()) : safeTarget();

  ctx.emit("flow:error", { path, error, rolledBackTo: framePath(target), retry });

  state.stack = [...target];
  // A rollback leaves any slot the loop was in: nothing of it may steer the next slot entry.
  state.slotAfter = undefined;

  if (!retry) {
    safe.inside = true;
    state.failures = 0;
  }

  return "continue";
}

/**
 * Leaves the aborted node: the transaction is discarded, the hints are dropped and the gate is
 * shut. `"stop"` ends the loop; `"restore"` lets the next turn enter the bookmark.
 *
 * @param modules - Injected sibling APIs.
 * @param transaction - The open transaction of the aborted node.
 * @param reason - Why the node was aborted.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 */
export function handleAbort(
  modules: Modules,
  transaction: Transaction,
  reason: AbortReason
): StepOutcome {
  transaction.discard();
  modules.fx.drop();
  modules.gate.close();

  return reason === "stop" ? "stop" : "continue";
}

/**
 * Moves the position to a planned place and, when that place is a rest node, makes it the rest
 * point of the loop: the frame rollback and `bookmark` return to, a zeroed failure count, a
 * compacted journal at a checkpoint, `flow:rest` and the walk's rest listeners. The caller marks the
 * rest point in the store first. Used by the edge, and by the loop when it enters a slot.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param plan - Where the loop stands now.
 */
export function arrive(ctx: FlowCtx, plan: Arrival): void {
  const state = ctx.state.runner;

  state.stack = plan.stack;
  state.slotAfter = plan.after;

  if (!plan.rest) return;

  state.restFrame = [...plan.stack];
  state.failures = 0;

  if (plan.checkpoint) compact(state);

  ctx.emit("flow:rest", { path: plan.next, checkpoint: plan.checkpoint });
  notifyRest(state, plan.next);
}

/**
 * Takes the edge of one result: plan, commit, mark the barrier or the rest point, move the
 * position and announce a rest node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The result ready to be committed.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 */
export async function finishNode(
  ctx: FlowCtx,
  modules: Modules,
  step: Commit,
  safe: Safe
): Promise<StepOutcome> {
  const state = ctx.state.runner;
  const plan = planFrom(
    ctx,
    [...state.stack],
    step.location,
    step.result.outcome,
    step.result.payload,
    0
  );

  if ("problem" in plan) {
    return handleFailure(ctx, modules, step.transaction, new Error(plan.problem), step.path, safe);
  }

  const entry = commitEdge(ctx, modules, step, plan.next);

  if (step.barrier) {
    await ctx.deps.model.store.markBarrier(`${step.path}#${entry.index}@${step.now}`);
  } else if (plan.rest) {
    ctx.deps.model.store.markRest();
  }

  arrive(ctx, plan);
  safe.inside = false;

  return "continue";
}

/**
 * Takes the edge of a result no node body produced: a substituted sub-flow, a finished slot or the
 * world event that ended a rest node. The empty transaction keeps the commit, the journal entry
 * and the rest mark in one place.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the result belongs.
 * @param result - The outcome to follow.
 * @param safe - Whether the loop is already recovering.
 * @param edge - The barrier flag of the node that produced it and the moment the edge is taken.
 * @param edge.barrier - True when the node the result belongs to is a barrier node.
 * @param edge.now - The moment the node was entered, journalled with the edge.
 * @returns Always `"continue"`.
 */
export function applyResult(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  result: Result,
  safe: Safe,
  edge: { barrier: boolean; now: number }
): Promise<StepOutcome> {
  return finishNode(
    ctx,
    modules,
    {
      location,
      transaction: ctx.deps.model.store.begin(),
      result,
      barrier: edge.barrier,
      now: edge.now,
      path: framePath(ctx.state.runner.stack)
    },
    safe
  );
}
