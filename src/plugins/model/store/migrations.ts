/**
 * @file model/store — the save migration chain and the shape check of a loaded save.
 */
import type { Json } from "../types";
import type { Migration, SaveDoc } from "./types";
import { SaveUnreadableError } from "./types";

/**
 * Narrows a JSON value to a record, without an assertion.
 *
 * @param value - Any JSON value.
 * @returns True when the value is a plain object.
 * @example
 * ```ts
 * if (!isRecord(state)) return undefined;
 * ```
 */
function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the stream table of a save.
 *
 * @param value - The `rng.streams` branch of the save.
 * @returns The stream table, or `undefined` when a stream state is not a number.
 * @example
 * ```ts
 * const streams = readStreams({ "chest:1": 7 });
 * ```
 */
function readStreams(value: Json | undefined): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;

  const streams: Record<string, number> = {};

  for (const [id, state] of Object.entries(value)) {
    if (typeof state !== "number") return undefined;
    streams[id] = state;
  }

  return streams;
}

/**
 * Reads a migrated save as a save document. A save the current build cannot understand is a
 * user-visible failure, never a silent reset: the caller shows a screen, the save stays on disk.
 *
 * @param state - The migrated save, as the provider stored it.
 * @param savedVersion - Version found in the save.
 * @param schemaVersion - Version this build writes.
 * @returns The save document `{ player, rng }`.
 * @throws {SaveUnreadableError} When the save has no player tree or no readable rng branch.
 * @example
 * ```ts
 * const doc = readSaveDoc(migrated, saved.version, config.schemaVersion);
 * ```
 */
export function readSaveDoc(state: Json, savedVersion: number, schemaVersion: number): SaveDoc {
  const record = isRecord(state) ? state : undefined;
  const branch = record ? record.rng : undefined;
  const rng = isRecord(branch) ? branch : undefined;
  const streams = readStreams(rng ? rng.streams : undefined);

  if (!record || record.player === undefined || !rng || typeof rng.seed !== "number" || !streams) {
    throw new SaveUnreadableError(
      savedVersion,
      schemaVersion,
      new Error(
        "[game] The save is not a document of the shape { player, rng }.\n  Restore the backup or start a new save."
      )
    );
  }

  return { player: record.player, rng: { seed: rng.seed, streams } };
}

/**
 * Runs the migration chain from the saved version to the schema version, one step per version.
 * A missing step, a throwing `up` or a save newer than this build is an error: the state is left
 * untouched so the app can show a clear screen instead of overwriting a save it cannot read.
 *
 * @param state - Saved state as loaded by the provider.
 * @param from - Version found in the save.
 * @param to - Version this build writes.
 * @param chain - Ordered migrations; `up` of `from: n` produces version `n + 1`.
 * @param onStep - Called before each step, with the version it migrates from and to.
 * @returns The migrated state.
 * @throws {SaveUnreadableError} When a step is missing, a step throws, or the save is newer.
 * @example
 * ```ts
 * const state = migrate(saved.state, saved.version, config.schemaVersion, config.migrations);
 * ```
 */
export function migrate(
  state: Json,
  from: number,
  to: number,
  chain: readonly Migration[],
  onStep?: (from: number, to: number) => void
): Json {
  if (from === to) return state;

  if (from > to) {
    throw new SaveUnreadableError(
      from,
      to,
      new Error(
        `[game] The save was written by a newer build.\n  Update the game to read version ${from}.`
      )
    );
  }

  let migrated = state;

  for (let version = from; version < to; version++) {
    const step = chain.find(candidate => candidate.from === version);

    if (!step) {
      throw new SaveUnreadableError(
        from,
        to,
        new Error(
          `[game] No migration step leads away from save version ${version}.\n  Add a migration with from: ${version}.`
        )
      );
    }

    onStep?.(version, version + 1);
    migrated = runStep(step, migrated, from, to);
  }

  return migrated;
}

/**
 * Runs one migration step and wraps a failure of the game's own code.
 *
 * @param step - The migration to run.
 * @param state - State as it stands before the step.
 * @param from - Version found in the save.
 * @param to - Version this build writes.
 * @returns The state after the step.
 * @throws {SaveUnreadableError} When `up` throws.
 * @example
 * ```ts
 * const next = runStep(step, state, 1, 2);
 * ```
 */
function runStep(step: Migration, state: Json, from: number, to: number): Json {
  try {
    return step.up(state);
  } catch (error) {
    throw new SaveUnreadableError(from, to, error);
  }
}
