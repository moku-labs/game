/**
 * @file model/rng — generator step and seed hash. Both are part of the save format.
 */

/** Start value of the xmur3 hash, the odd 32-bit constant of the original. */
const hashStart = 1_779_033_703;

/** Mixing multiplier applied per character. */
const hashMixer = 3_432_918_353;

/** First avalanche multiplier of the hash finaliser. */
const hashFinaliserA = 2_246_822_507;

/** Second avalanche multiplier of the hash finaliser. */
const hashFinaliserB = 3_266_489_909;

/** Increment of one mulberry32 step. */
const stepIncrement = 0x6d_2b_79_f5;

/**
 * Hashes a seed and a stream id into the initial uint32 state of the stream.
 * An `xmur3`-style mix: every character folds into the state, then an avalanche spreads the bits,
 * so `"chest:41"` and `"chest:42"` start far apart.
 *
 * This is part of the save format: a change here re-rolls every chest of every existing save.
 *
 * @param seed - Seed of the save.
 * @param id - Stream id, for example `"chest:42"`.
 * @returns The initial uint32 state of the stream.
 * @example
 * ```ts
 * hash32(42, "chest:42"); // 2485943101
 * ```
 */
export function hash32(seed: number, id: string): number {
  let state = (hashStart ^ id.length ^ Math.trunc(seed)) >>> 0;

  for (let index = 0; index < id.length; index++) {
    state = Math.imul(state ^ (id.codePointAt(index) ?? 0), hashMixer);
    state = (state << 13) | (state >>> 19);
  }

  // Avalanche: without it two neighbouring ids would produce neighbouring streams.
  state = Math.imul(state ^ (state >>> 16), hashFinaliserA);
  state = Math.imul(state ^ (state >>> 13), hashFinaliserB);

  return (state ^ (state >>> 16)) >>> 0;
}

/**
 * Advances a stream by one `mulberry32` step. Pure: the same state always yields the same pair.
 * Integer arithmetic only, so every engine produces the same numbers.
 *
 * This is part of the save format: a change here re-rolls every chest of every existing save.
 *
 * @param state - Current uint32 state of the stream.
 * @returns The drawn uint32 value and the next state of the stream.
 * @example
 * ```ts
 * nextUint32(2485943101); // { value: 2042392555, state: 22541618 }
 * ```
 */
export function nextUint32(state: number): { value: number; state: number } {
  const next = (state + stepIncrement) >>> 0;

  let mixed = Math.imul(next ^ (next >>> 15), next | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

  return { value: (mixed ^ (mixed >>> 14)) >>> 0, state: next };
}
