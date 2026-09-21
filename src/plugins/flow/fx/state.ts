/**
 * @file flow/fx — state factory skeleton.
 */
import type { FxState } from "./types";

/**
 * Creates the fx module state: no handler, no buffered hint, no pending completion, mode `"live"`.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const fx = createFxState();
 * ```
 */
export function createFxState(): FxState {
  throw new Error("not implemented");
}
