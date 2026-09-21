/**
 * @file model/rng — state factory.
 */

/**
 * Creates the rng module state. It is empty: the rng data lives in the save document, so a draw
 * commits and rolls back with the transaction that drew it.
 *
 * @returns The empty rng branch of the plugin state.
 * @example
 * ```ts
 * const state = { store: createStoreState(config), rng: createRngState() };
 * ```
 */
export function createRngState(): Record<string, never> {
  return {};
}
