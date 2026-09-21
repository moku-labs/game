/**
 * @file flow/runner — the one loop skeleton. The only place that calls `transaction.commit()`.
 */
import type { FlowCtx } from "../types";
import type { Modules } from "./types";

/**
 * Runs the graph until aborted: enter node, `onEnter` stages, begin a transaction, await the
 * body, commit on the edge, release hints, journal, emit `flow:edge`, follow the edge. An error
 * discards, rolls back and retries, then enters `safeNode`; a failure inside `safeNode` rejects.
 * Abort reasons: `"stop"` ends the loop, `"inbox"` turns the event into the outcome, `"restore"`
 * enters the bookmark's frame.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs: features, fx, gate, inbox.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * state.runner.running = runLoop(ctx, modules);
 * ```
 */
export function runLoop(_ctx: FlowCtx, _modules: Modules): Promise<void> {
  throw new Error("not implemented");
}
