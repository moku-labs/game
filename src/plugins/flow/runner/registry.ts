/**
 * @file flow/runner — flow registry and graph description skeleton.
 */
import type { FeaturesApi } from "../features/types";
import type { AnyFlow, FlowGraph } from "./types";

/**
 * Collects every flow reachable from the main flow by reference, plus the registered extras.
 *
 * @param _main - The top-level flow.
 * @param _extra - Flows added with `register`, not reachable by reference.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const flows = collectFlows(mainFlow, [debugFlow]);
 * ```
 */
export function collectFlows(_main: AnyFlow, _extra: readonly AnyFlow[]): Map<string, AnyFlow> {
  throw new Error("not implemented");
}

/**
 * Renders the whole graph as JSON without running the game: nodes, flags, outcomes, edges,
 * slots and who contributed. Edge targets become `"node"`, `"exit:win"`, `"map:node"`.
 *
 * @param _flows - Every collected flow by id.
 * @param _features - Features API: owners and slot contributions.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const graph = describeGraph(flows, features);
 * ```
 */
export function describeGraph(
  _flows: ReadonlyMap<string, AnyFlow>,
  _features: FeaturesApi
): FlowGraph {
  throw new Error("not implemented");
}

/**
 * Hashes a graph description. A bookmark of a plain rest node is accepted only while this hash
 * is unchanged.
 *
 * @param _graph - Result of `describeGraph`.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const hash = graphHash(describeGraph(flows, features));
 * ```
 */
export function graphHash(_graph: FlowGraph): string {
  throw new Error("not implemented");
}
