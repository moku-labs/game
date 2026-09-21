/**
 * @file flow/runner — the seam the fast walk and restore steer the loop with.
 */
import type { LoopSeam, Result, RunnerState } from "./types";

/**
 * Creates the empty substitution table. It lives in its own function because the plugin's lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of path to substituted result.
 * @example
 * ```ts
 * emptySubstitutions().size; // 0
 * ```
 */
function emptySubstitutions(): Map<string, Result> {
  return new Map();
}

/**
 * Reads the seam the fast walk and `restore` steer the running loop with, and creates it on first
 * use. Everything in it is empty while the game just runs.
 *
 * @param state - Runner state.
 * @returns The seam of this runner.
 */
export function loopSeam(state: RunnerState): LoopSeam {
  const existing = state.seam;

  if (existing !== undefined) return existing;

  const seam: LoopSeam = {
    substitutions: emptySubstitutions(),
    rest: [],
    gateOpen: [],
    restoring: undefined
  };

  state.seam = seam;

  return seam;
}

/**
 * Tells whether a sub-flow at this path is substituted, so the loop must not enter it.
 *
 * @param state - Runner state.
 * @param path - Path of the sub-flow node.
 * @returns True while a walk holds a result for it.
 */
export function hasSubstitution(state: RunnerState, path: string): boolean {
  return state.seam?.substitutions.has(path) ?? false;
}

/**
 * Takes the substituted result of a sub-flow. It is used once.
 *
 * @param state - Runner state.
 * @param path - Path of the sub-flow node.
 * @returns The result a walk substituted, or `undefined`.
 */
export function takeSubstitution(state: RunnerState, path: string): Result | undefined {
  const result = state.seam?.substitutions.get(path);

  if (result === undefined) return undefined;

  state.seam?.substitutions.delete(path);

  return result;
}

/**
 * Tells the walk and `restore` that the loop rests.
 *
 * @param state - Runner state.
 * @param path - Path of the rest node just entered.
 */
export function notifyRest(state: RunnerState, path: string): void {
  const listeners = state.seam?.rest;

  if (listeners === undefined) return;

  const current = [...listeners];

  for (const listener of current) listener(path);
}

/**
 * Tells the walk that the gate of a rest node is open. The loop is the one that opens the gate, so
 * the gate module never learns about the walk.
 *
 * @param state - Runner state.
 */
export function notifyGateOpen(state: RunnerState): void {
  const listeners = state.seam?.gateOpen;

  if (listeners === undefined) return;

  const current = [...listeners];

  for (const listener of current) listener();
}
