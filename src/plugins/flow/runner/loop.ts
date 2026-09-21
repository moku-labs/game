/**
 * @file flow/runner — the one loop: one turn, the loop, entering a position from outside.
 */
import type { FlowCtx } from "../types";
import { applyResult, finishNode, handleAbort, handleFailure } from "./edge";
import { checkGraph, collectGraph, requireMainFlow } from "./graph";
import type { Delivery, Location, Safe, Step, StepOutcome } from "./loop-types";
import { noPayload } from "./loop-types";
import { nodeInfo, nodeOutcome, runEnterCallbacks, stopped, waitForPointer } from "./node";
import { pickContribution } from "./plan";
import { eventResult, framesOf, locateFrames } from "./position";
import { findNode, framePath } from "./registry";
import { loopSeam, notifyGateOpen, notifyRest, takeSubstitution } from "./seam";
import type { AnyFlow, AnyNode, Bookmark, Modules, SlotNode } from "./types";

/**
 * Runs one node: wait for the pointer, `onEnter` stages, open the transaction, produce the
 * outcome, then commit on the edge or recover.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the node sits in the graph.
 * @param node - The node to run.
 * @param safe - Whether the loop is already recovering.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 * @example
 * ```ts
 * return runNode(ctx, modules, location, location.entry, safe);
 * ```
 */
async function runNode(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  node: AnyNode,
  safe: Safe
): Promise<StepOutcome> {
  const state = ctx.state.runner;
  const path = framePath(state.stack);

  if (node.over) await waitForPointer(ctx);

  if (stopped(state)) return "stop";
  if (state.seam?.restoring !== undefined) return "continue";

  const abort = new AbortController();

  state.abort = abort;

  const now = ctx.deps.clock.now();

  try {
    await runEnterCallbacks(ctx, nodeInfo(path, location, node), abort.signal);
  } catch (error) {
    return handleFailure(ctx, modules, undefined, error, path, safe);
  }

  const step: Step = {
    location,
    node,
    transaction: ctx.deps.model.store.begin(),
    abort,
    signal: abort.signal,
    now,
    path,
    input: state.stack.at(-1)?.input ?? noPayload,
    /**
     * Tells a walk that this node's gate is open.
     *
     * @example
     * ```ts
     * step.gateOpened();
     * ```
     */
    gateOpened: (): void => {
      notifyGateOpen(state);
    }
  };
  const delivered: Delivery = { event: undefined };
  const outcome = await nodeOutcome(modules, step, delivered);

  // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts a running guide.
  modules.gate.narrow(undefined);

  if (outcome.kind === "failed") {
    return handleFailure(ctx, modules, step.transaction, outcome.error, path, safe);
  }

  if (outcome.kind === "aborted") return handleAbort(modules, step.transaction, outcome.reason);

  if (outcome.kind === "event") {
    handleAbort(modules, step.transaction, "inbox");

    return applyResult(ctx, modules, location, eventResult(outcome.event), safe, {
      barrier: node.barrier,
      now
    });
  }

  return finishNode(
    ctx,
    modules,
    {
      location,
      transaction: step.transaction,
      result: outcome.result,
      barrier: node.barrier,
      now,
      path
    },
    safe
  );
}

/**
 * Enters a sub-flow at its start node, unless a walk substituted its result.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the sub-flow node sits.
 * @param sub - The sub-flow.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return enterSubFlow(ctx, modules, location, location.entry, safe);
 * ```
 */
function enterSubFlow(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  sub: AnyFlow,
  safe: Safe
): Promise<StepOutcome> | StepOutcome {
  const state = ctx.state.runner;
  const substituted = takeSubstitution(state, framePath(state.stack));

  if (substituted !== undefined) {
    return applyResult(ctx, modules, location, substituted, safe, {
      barrier: false,
      now: ctx.deps.clock.now()
    });
  }

  state.stack = [
    ...state.stack,
    { flow: sub.id, node: sub.start, input: state.stack.at(-1)?.input ?? noPayload }
  ];

  return "continue";
}

/**
 * Enters a slot: the first contribution whose `when` passes, or the slot's `done` edge when the
 * slot has no contribution to run.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the slot sits.
 * @param slot - The slot node.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return enterSlot(ctx, modules, location, location.entry, safe);
 * ```
 */
function enterSlot(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  slot: SlotNode,
  safe: Safe
): Promise<StepOutcome> | StepOutcome {
  const state = ctx.state.runner;
  const next = pickContribution(ctx, modules.features, slot.name, 0);

  if (next === undefined) {
    return applyResult(ctx, modules, location, { outcome: "done", payload: noPayload }, safe, {
      barrier: false,
      now: ctx.deps.clock.now()
    });
  }

  state.stack = [...state.stack, { flow: next.flow.id, node: next.flow.start, input: noPayload }];

  return "continue";
}

/**
 * Enters the node of a bookmark: the state is replaced, the rest point is marked and the position
 * becomes the bookmark's path.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param bookmark - The bookmark to enter.
 * @throws {Error} When the graph has no node at the bookmark's path.
 * @example
 * ```ts
 * enterBookmark(ctx, bookmark);
 * ```
 */
function enterBookmark(ctx: FlowCtx, bookmark: Bookmark): void {
  const state = ctx.state.runner;
  const location = findNode(requireMainFlow(ctx), bookmark.path);

  loopSeam(state).restoring = undefined;

  if (location === undefined) {
    throw new Error(
      `[game] The bookmark names no node "${bookmark.path}".\n  Bookmark a rest node of the running graph.`
    );
  }

  ctx.deps.model.store.restore({
    player: bookmark.player,
    session: bookmark.session,
    rng: bookmark.rng
  });
  ctx.deps.model.store.markRest();

  state.stack = framesOf(location.trail, bookmark.input);
  state.restFrame = [...state.stack];
  state.failures = 0;

  const entry = location.entry;

  ctx.emit("flow:rest", {
    path: bookmark.path,
    checkpoint: entry.kind === "node" && entry.checkpoint
  });
  notifyRest(state, bookmark.path);
}

/**
 * Runs one turn: enter a bookmark, descend into a sub-flow, step a slot, or run the node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param safe - Whether the loop is already recovering.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 * @throws {Error} When the position names no node of the graph.
 * @example
 * ```ts
 * const outcome = await advance(ctx, modules, safe);
 * ```
 */
async function advance(ctx: FlowCtx, modules: Modules, safe: Safe): Promise<StepOutcome> {
  const state = ctx.state.runner;

  if (stopped(state)) return "stop";

  const restoring = state.seam?.restoring;

  if (restoring !== undefined) {
    enterBookmark(ctx, restoring);

    return "continue";
  }

  const location = locateFrames(ctx, state.stack);

  if (location === undefined) {
    throw new Error(
      `[game] The graph has no node at "${framePath(state.stack)}".\n  Check the edge targets of the flow or the bookmark that was restored.`
    );
  }

  if (location.entry.kind === "flow") {
    return enterSubFlow(ctx, modules, location, location.entry, safe);
  }

  if (location.entry.kind === "slot") {
    return enterSlot(ctx, modules, location, location.entry, safe);
  }

  return runNode(ctx, modules, location, location.entry, safe);
}

// ─── the loop ─────────────────────────────────────────────────

/**
 * Runs the graph until aborted: enter node, `onEnter` stages, begin a transaction, await the
 * body, commit on the edge, release hints, journal, emit `flow:edge`, follow the edge. An error
 * discards, rolls back and retries, then enters `safeNode`; a failure inside `safeNode` rejects.
 * Abort reasons: `"stop"` ends the loop, `"inbox"` turns the event into the outcome, `"restore"`
 * enters the bookmark's frame.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @returns A promise that resolves when `onStop` aborted the loop.
 * @throws {Error} On a fatal error: validation, an unreadable save, a failure inside `safeNode`.
 * @example
 * ```ts
 * state.runner.running = runLoop(ctx, modules);
 * ```
 */
export async function runLoop(ctx: FlowCtx, modules: Modules): Promise<void> {
  const main = requireMainFlow(ctx);
  const state = ctx.state.runner;

  state.flows = collectGraph(ctx, modules.features);
  checkGraph(ctx, modules.features);
  modules.features.seal();

  await ctx.deps.model.store.load();

  state.stack = [{ flow: main.id, node: main.start, input: noPayload }];
  state.restFrame = [...state.stack];
  state.failures = 0;

  const safe: Safe = { inside: false };
  const loop = { running: true };

  while (loop.running) {
    loop.running = (await advance(ctx, modules, safe)) === "continue";
  }
}

// ─── entering a position from outside the loop ────────────────

/**
 * Restores a bookmark through the running loop: the active node is aborted with reason
 * `"restore"`, its transaction is discarded, the state is replaced and the node is entered.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns A promise that resolves once the loop rests at the bookmark's node.
 * @throws {Error} When the loop is not running.
 * @example
 * ```ts
 * await restorePosition(ctx, modules, bookmark);
 * ```
 */
export function restorePosition(
  ctx: FlowCtx,
  _modules: Modules,
  bookmark: Bookmark
): Promise<void> {
  const state = ctx.state.runner;

  if (state.running === undefined) {
    throw new Error(
      "[game] flow.restore() needs a running graph.\n  Call flow.run() from the createApp onStart callback first."
    );
  }

  const seam = loopSeam(state);
  const entered = new Promise<void>(resolve => {
    /**
     * Resolves once, when the loop rests at the restored node.
     *
     * @example
     * ```ts
     * listener("home");
     * ```
     */
    const listener = (): void => {
      const index = seam.rest.indexOf(listener);

      if (index !== -1) seam.rest.splice(index, 1);

      resolve();
    };

    seam.rest.push(listener);
  });

  seam.restoring = bookmark;
  state.abort?.abort("restore");
  ctx.state.gate.wake?.();

  return entered;
}

export { collectGraph } from "./graph";
export { loopSeam } from "./seam";
export { stopRunner } from "./stop";
