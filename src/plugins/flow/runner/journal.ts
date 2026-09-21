/**
 * @file flow/runner — journal of taken edges skeleton.
 */
import type { JournalEntry, RunnerState } from "./types";

/**
 * Hashes one edge, so a replay against edited code fails loudly in dev.
 *
 * @param _path - Path of the node that produced the outcome.
 * @param _outcome - Outcome name.
 * @param _next - Rendered edge target.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const hash = entryHash("board/merge", "done", "awaitIntent");
 * ```
 */
export function entryHash(_path: string, _outcome: string, _next: string): string {
  throw new Error("not implemented");
}

/**
 * Appends an entry with the next index and its hash, and drops the oldest entries above the limit.
 *
 * @param _state - Runner state that holds the journal.
 * @param _entry - The taken edge without `index` and `hash`.
 * @param _limit - Journal entries kept between checkpoints.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const entry = pushEntry(state.runner, { path, outcome, payload, next, now }, config.journalLimit);
 * ```
 */
export function pushEntry(
  _state: RunnerState,
  _entry: Omit<JournalEntry, "index" | "hash">,
  _limit: number
): JournalEntry {
  throw new Error("not implemented");
}

/**
 * Clears the journal at a checkpoint. The running index is kept.
 *
 * @param _state - Runner state that holds the journal.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * if (node.checkpoint) compact(state.runner);
 * ```
 */
export function compact(_state: RunnerState): void {
  throw new Error("not implemented");
}
