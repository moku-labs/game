/**
 * @file model/store — save migration chain skeleton.
 */
import type { Json } from "../types";
import type { Migration } from "./types";

/**
 * Runs the migration chain from the saved version to the schema version.
 * A missing step, a throwing `up` or a newer save is an error.
 *
 * @param _state - Saved state as loaded by the provider.
 * @param _from - Version found in the save.
 * @param _to - Version this build writes.
 * @param _chain - Ordered migrations; `up` of `from: n` produces version `n + 1`.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = migrate(saved.state, saved.version, config.schemaVersion, config.migrations);
 * ```
 */
export function migrate(
  _state: Json,
  _from: number,
  _to: number,
  _chain: readonly Migration[]
): Json {
  throw new Error("not implemented");
}
