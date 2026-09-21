/**
 * @file flow/runner — fast walk, bookmark and restore skeleton.
 */
import type { FlowCtx } from "../types";
import type { Bookmark, FlowState, Modules, RouteStep } from "./types";

/**
 * Walks a route in fast mode: waits until the loop rests at each step's `at`, answers through
 * the gate or substitutes a sub-flow result, then restores the previous mode. Rejects when a
 * step is never reached, naming the path where the loop rests.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs: features, fx, gate, inbox.
 * @param _route - The player's answers and substituted results, in order.
 * @param _from - Bookmark restored before the first step.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = await walkRoute(ctx, modules, [{ at: "home", intent: "play" }]);
 * ```
 */
export function walkRoute(
  _ctx: FlowCtx,
  _modules: Modules,
  _route: readonly RouteStep[],
  _from?: Bookmark
): Promise<FlowState> {
  throw new Error("not implemented");
}

/**
 * Makes a bookmark of the current rest point: path, input, committed state, rng and graph hash.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const bookmark = makeBookmark(ctx);
 * ```
 */
export function makeBookmark(_ctx: FlowCtx): Bookmark {
  throw new Error("not implemented");
}

/**
 * Restores a bookmark: aborts the active node with reason `"restore"`, discards the open
 * transaction, replaces state through `model.store.restore`, marks a rest point and enters the
 * node. A plain rest node is accepted only when the graph hash matches.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs: features, fx, gate, inbox.
 * @param _bookmark - Bookmark produced by `bookmark()` or built for a checkpoint.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * await restoreBookmark(ctx, modules, bookmark);
 * ```
 */
export function restoreBookmark(
  _ctx: FlowCtx,
  _modules: Modules,
  _bookmark: Bookmark
): Promise<void> {
  throw new Error("not implemented");
}
