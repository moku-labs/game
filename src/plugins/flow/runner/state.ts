/**
 * @file flow/runner — state factory skeleton.
 */
import type { RunnerState } from "./types";

/**
 * Creates the runner module state: no flow collected, an empty stack and journal, not running.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const runner = createRunnerState();
 * ```
 */
export function createRunnerState(): RunnerState {
  throw new Error("not implemented");
}
