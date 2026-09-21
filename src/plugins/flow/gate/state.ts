/**
 * @file flow/gate — state factory.
 */
import type { GateState } from "./types";

/**
 * Creates the gate module state: the gate is closed, nothing is held, no pointer is down.
 *
 * @returns The initial gate state.
 * @example
 * ```ts
 * const gate = createGateState();
 * ```
 */
export function createGateState(): GateState {
  return {
    open: undefined,
    resolve: undefined,
    held: undefined,
    narrow: undefined,
    pointerActive: false,
    wake: undefined
  };
}
