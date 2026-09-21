/**
 * @file flow/runner — static graph validation skeleton.
 */
import type { FeaturesApi } from "../features/types";
import type { Config } from "../types";
import type { AnyFlow } from "./types";

/**
 * Validates the whole graph at `run()` and returns every problem as one `[game] …` message:
 * unreachable node, outcome without an edge, missing target, barrier edge that does not reach a
 * rest node of the same flow, cycle with no rest node, slot without a name, equal contribution
 * `order`, `inbox` type that is not an outcome, rest node with neither `run` nor outcomes,
 * `safeNode` that is not a checkpoint, colliding ids. Types are bypassed by JSON data and casts,
 * so this runs even though the edge table is checked at compile time.
 *
 * @param _flows - Every collected flow by id.
 * @param _features - Features API: slot contributions and feature names.
 * @param _config - Resolved flow config: `mainFlow`, `safeNode`.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const problems = validateGraph(flows, features, config);
 * if (problems.length > 0) throw new Error(problems.join("\n"));
 * ```
 */
export function validateGraph(
  _flows: ReadonlyMap<string, AnyFlow>,
  _features: FeaturesApi,
  _config: Readonly<Config>
): string[] {
  throw new Error("not implemented");
}
