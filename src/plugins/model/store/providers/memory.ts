/**
 * @file model/store — in-memory player state provider skeleton.
 */
import type { Json } from "../../types";
import type { PlayerStateProvider, ProviderCall, SaveDoc } from "../types";

/**
 * Creates an in-memory provider that persists nothing and records every call.
 *
 * @param _fixture - Save returned by `load()`. Omitted: a new player.
 * @param _fixture.state - The saved document.
 * @param _fixture.version - Schema version of the saved document.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const provider = memory({ state: saveOf({ coins: 5 }, 42), version: 1 });
 * ```
 */
export function memory(_fixture?: {
  state: SaveDoc;
  version: number;
}): PlayerStateProvider & { calls: ProviderCall[] } {
  throw new Error("not implemented");
}

/**
 * Builds a save document from a player tree, with no rng streams drawn yet.
 *
 * @param _player - Player tree of the save.
 * @param _seed - Rng seed of the save.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const doc = saveOf({ coins: 5 }, 42);
 * ```
 */
export function saveOf(_player: Json, _seed?: number): SaveDoc {
  throw new Error("not implemented");
}
