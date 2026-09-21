/**
 * @file flow/gate — state factory skeleton.
 */
import type { GateState } from "./types";

/**
 * Creates the gate module state: the gate is closed, nothing is held, no pointer is down.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const gate = createGateState();
 * ```
 */
export function createGateState(): GateState {
  throw new Error("not implemented");
}
