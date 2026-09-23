/**
 * @file What the splash waits for, as plain data and pure functions: the three bundles Home and
 * the board need, how far each one has come, and the share of the whole. The plugin in
 * `plugin.ts` feeds it from the asset events and posts what it computes into the flow inbox.
 */

/** The bundles the splash waits for: Home, the board and the order cards. */
export const watchedBundles = ["home", "board", "orders"] as const;

/**
 * How far the loading has come.
 *
 * @example
 * ```ts
 * const state: LoadingState = { shares: { home: 1, board: 0.5 }, loaded: ["home"], posted: false, reported: 0.5 };
 * ```
 */
export type LoadingState = {
  /** The share of each watched bundle that has settled, 0..1. */
  shares: Record<string, number>;
  /** The watched bundles that are loaded. */
  loaded: string[];
  /** Whether `loaded` went into the inbox. After it nothing is posted any more. */
  posted: boolean;
  /** The share last posted, so the same number is never posted twice. */
  reported: number;
};

/**
 * The state of a splash that has seen nothing yet.
 *
 * @returns A fresh state.
 * @example
 * ```ts
 * createLoadingState(); // { shares: {}, loaded: [], posted: false, reported: -1 }
 * ```
 */
export function createLoadingState(): LoadingState {
  return { shares: {}, loaded: [], posted: false, reported: -1 };
}

/**
 * Whether the splash watches a bundle.
 *
 * @param bundle - The bundle an event named.
 * @returns True for `home`, `board` and `orders`.
 * @example
 * ```ts
 * isWatched("ui"); // false
 * ```
 */
export function isWatched(bundle: string): boolean {
  return (watchedBundles as readonly string[]).includes(bundle);
}

/**
 * Records one file that settled. A loaded bundle keeps its full share, whatever a later load of
 * it says.
 *
 * @param state - The loading state.
 * @param bundle - The bundle the file belongs to.
 * @param share - The settled files of the bundle over its file count.
 */
export function recordProgress(state: LoadingState, bundle: string, share: number): void {
  if (state.loaded.includes(bundle)) return;

  state.shares[bundle] = Math.min(1, Math.max(0, share));
}

/**
 * Records a bundle that is loaded.
 *
 * @param state - The loading state.
 * @param bundle - The bundle that is in.
 */
export function recordLoaded(state: LoadingState, bundle: string): void {
  state.shares[bundle] = 1;

  if (!state.loaded.includes(bundle)) state.loaded.push(bundle);
}

/**
 * The share of the whole: the mean of the three bundles, on two decimals.
 *
 * @param state - The loading state.
 * @returns 0..1.
 * @example
 * ```ts
 * shareOf({ shares: { home: 1, board: 0.5 }, loaded: ["home"], posted: false, reported: 0 }); // 0.5
 * ```
 */
export function shareOf(state: LoadingState): number {
  const sum = watchedBundles.reduce((total, bundle) => total + (state.shares[bundle] ?? 0), 0);

  return Math.round((sum / watchedBundles.length) * 100) / 100;
}

/**
 * Whether every watched bundle is loaded.
 *
 * @param state - The loading state.
 * @returns True when Home, the board and the orders are in.
 */
export function isComplete(state: LoadingState): boolean {
  return watchedBundles.every(bundle => state.loaded.includes(bundle));
}
