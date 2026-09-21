/**
 * @file flow/fx — state factory.
 */
import type { FxState } from "./types";

/**
 * Creates the empty handler registry. It lives in its own function because the plugin's lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of effect kind to handler.
 * @example
 * ```ts
 * emptyHandlers().size; // 0
 * ```
 */
function emptyHandlers(): FxState["handlers"] {
  return new Map();
}

/**
 * Creates the fx module state: no handler, no hint listener, no buffered hint, no pending
 * completion, mode `"live"`.
 *
 * @returns A fresh fx state, owned by the plugin state of `flow`.
 */
export function createFxState(): FxState {
  return {
    handlers: emptyHandlers(),
    buffered: [],
    hintListeners: [],
    settled: [],
    mode: "live"
  };
}
