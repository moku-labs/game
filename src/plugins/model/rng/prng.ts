/**
 * @file model/rng — generator step and seed hash skeleton. Both are part of the save format.
 */

/**
 * Hashes a seed and a stream id into the initial uint32 state of the stream.
 *
 * @param _seed - Seed of the save.
 * @param _id - Stream id.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * streams[id] = hash32(seed, "chest:42");
 * ```
 */
export function hash32(_seed: number, _id: string): number {
  throw new Error("not implemented");
}

/**
 * Advances a stream by one step.
 *
 * @param _state - Current uint32 state of the stream.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const { value, state } = nextUint32(streams[id]);
 * ```
 */
export function nextUint32(_state: number): { value: number; state: number } {
  throw new Error("not implemented");
}
