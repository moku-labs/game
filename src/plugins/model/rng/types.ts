/**
 * @file model/rng — type definitions.
 */

/**
 * Persisted randomness: one uint32 per stream id.
 *
 * @example
 * ```ts
 * const rng: RngState = { seed: 42, streams: { "chest:42": 123456789 } };
 * ```
 */
export type RngState = { seed: number; streams: Record<string, number> };

/**
 * One deterministic stream. Integers only.
 *
 * @example
 * ```ts
 * const reward = transaction.rng.stream("chest:42").pick(rewards);
 * ```
 */
export type RngStream = {
  int(maxExclusive: number): number;
  range(min: number, maxInclusive: number): number;
  pick<Item>(items: readonly Item[]): Item;
  weighted<Entry extends { weight: number }>(table: readonly Entry[]): Entry;
  chance(numerator: number, denominator: number): boolean;
};

/**
 * View over an rng branch, draft or frozen.
 *
 * @example
 * ```ts
 * const view: RngView = createRngView(doc.rng);
 * view.stream("chest:42").int(6);
 * ```
 */
export type RngView = { stream(id: string): RngStream };

/**
 * Factory injected into the store module.
 *
 * @example
 * ```ts
 * createStoreApi(ctx, { createRngView });
 * ```
 */
export type CreateRngView = (branch: RngState) => RngView;

/**
 * rng module API.
 *
 * @example
 * ```ts
 * const state = ctx.require(modelPlugin).rng.peek("chest:42");
 * ```
 */
export type RngApi = { peek(id: string): number | undefined };
