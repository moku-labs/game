/**
 * @file flow/runner — state factory.
 */
import type { RunnerState } from "./types";

/**
 * Creates the empty flow registry. It lives in its own function because the plugin's lint rule
 * L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of flow id to flow.
 * @example
 * ```ts
 * const flows = emptyFlows();
 * ```
 */
function emptyFlows(): RunnerState["flows"] {
  return new Map();
}

/**
 * Creates the runner module state: no flow collected, an empty stack and journal, not running.
 * Every state gets its own collections, so two apps in one process never share a position.
 *
 * @returns A fresh runner state.
 * @example
 * ```ts
 * const runner = createRunnerState();
 * ```
 */
export function createRunnerState(): RunnerState {
  return {
    flushing: undefined,
    flows: emptyFlows(),
    enterCallbacks: { load: [], scene: [] },
    stack: [],
    restFrame: undefined,
    journal: [],
    journalIndex: 0,
    running: undefined,
    abort: undefined,
    failures: 0
  };
}
