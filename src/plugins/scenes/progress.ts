/**
 * @file scenes plugin — the switch a leave loader projection reads (F107 part 1). `world.projection.feed` hands its
 * `from` a `SceneSwitch`, `{ from, to, progress }`, as a third argument: while a scene stands, its held loader reads
 * `{ from: current, to: current, progress: 0 }`; a switch feeds it the scene left, the scene entered and the share of
 * the switch's bundles loaded, in steps of 0.01 up to 1: a bundle loaded at the start counts whole, one being loaded
 * counts its files from `assets:bundle-progress`, and every bundle the scene stage finds loaded counts whole (a bundle
 * with no file sends no progress). Only a loader scenes holds, or one with no view yet (A2, mounted at its due), is
 * fed: a projection another owner shows never is. The progress is counted in integer thousandths, so the last value
 * fed is exactly 1.
 */
import { namedBundles } from "./bundles";
import type {
  BundleShare,
  Leaving,
  LoaderFeed,
  SceneDefinition,
  SceneState,
  ScenesCtx,
  State
} from "./types";

/** A bundle loaded, and a switch whose bundles are all in, in thousandths. */
const WHOLE = 1000;

/** The growth of the progress, in thousandths, a switch waits for before it feeds the loader again: 0.01. */
const STEP = 10;

/**
 * Reads the committed state a scene's `bundles` gets: the frozen trees of the store, in a frozen
 * wrapper. During the scene stage no node writes, so it is the state the node is entered with.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The committed `player` and `session`.
 */
export function committedState(ctx: ScenesCtx): SceneState {
  const { player, session } = ctx.deps.model.store.snapshot();

  return Object.freeze({ player, session });
}

/**
 * The share of a bundle one progress event tells, in thousandths, floored: the whole once every file settled.
 *
 * @param loaded - The settled files.
 * @param total - The files of the bundle.
 * @returns 0 to 1000.
 * @example
 * ```ts
 * shareOf(1, 3); // 333
 * ```
 */
function shareOf(loaded: number, total: number): number {
  return loaded >= total ? WHOLE : Math.floor((WHOLE * loaded) / total);
}

/**
 * The progress of a switch, in thousandths: the mean of its bundles' shares, floored; the whole with no bundle.
 *
 * @param bundles - The table of the switch.
 * @returns 0 to 1000.
 * @example
 * ```ts
 * meanOf([{ bundle: "board", share: 250 }, { bundle: "ep01", share: 0 }]); // 125
 * ```
 */
function meanOf(bundles: readonly BundleShare[]): number {
  if (bundles.length === 0) return WHOLE;

  let sum = 0;

  for (const row of bundles) sum += row.share;

  return Math.floor(sum / bundles.length);
}

/**
 * Tells whether the progress moved far enough to feed the loader again: by 0.01 since the last feed, or onto the whole
 * for the first time.
 *
 * @param fed - The progress last fed, in thousandths.
 * @param now - The progress now, in thousandths.
 * @returns True when the loader is fed.
 * @example
 * ```ts
 * isStep(995, 1000); // true: the switch is done
 * ```
 */
function isStep(fed: number, now: number): boolean {
  return now - fed >= STEP || (now === WHOLE && fed < WHOLE);
}

/**
 * The row of a bundle in the table of a switch.
 *
 * @param bundles - The table.
 * @param bundle - The bundle.
 * @returns Its row, or `undefined` for a bundle the switch does not name.
 * @example
 * ```ts
 * rowOf([{ bundle: "board", share: 0 }], "ep01"); // undefined
 * ```
 */
function rowOf(bundles: readonly BundleShare[], bundle: string): BundleShare | undefined {
  for (const row of bundles) {
    if (row.bundle === bundle) return row;
  }

  return undefined;
}

/**
 * The table of a switch: one row per bundle the scene being switched to names for the committed state, a bundle
 * loaded already counted whole. A `bundles` that throws gives an empty table, a switch done: the `scene` stage throws
 * it again, as it does without a loader.
 *
 * @param ctx - Domain context of the plugin.
 * @param scene - The scene being switched to.
 * @returns The rows, in the order the scene names its bundles.
 */
function sharesOf(ctx: ScenesCtx, scene: SceneDefinition): BundleShare[] {
  let named: readonly string[];

  try {
    named = namedBundles(scene, committedState(ctx));
  } catch {
    return [];
  }

  const assets = ctx.deps.assets;

  return named.map(bundle => ({ bundle, share: assets.isLoaded(bundle) ? WHOLE : 0 }));
}

/**
 * Starts feeding the loader projection of a switch, before it is due: the table of its bundles, one `feed` bound to
 * the name, and the first value, `{ from, to, progress }`. A held loader only stores it, and the show writes it into
 * the view built ahead once; a loader with no view (A2) reads it when it is mounted at its due. A projection another
 * owner shows is not fed: a held one answers no entity either, so a view means someone else's.
 *
 * @param ctx - Domain context of the plugin.
 * @param leaving - The look of the switch: it keeps what it feeds.
 * @param name - The loader projection.
 * @param between - The scene being left and the scene being switched to.
 * @param between.from - The scene being left.
 * @param between.to - The scene being switched to.
 */
export function startFeeding(
  ctx: ScenesCtx,
  leaving: Leaving,
  name: string,
  between: { from: SceneDefinition; to: SceneDefinition }
): void {
  const projection = ctx.deps.world.projection;

  if (projection.entitiesOf(name).length > 0) return;

  const bundles = sharesOf(ctx, between.to);
  const feeding: LoaderFeed = {
    name,
    from: between.from.id,
    to: between.to.id,
    bundles,
    fed: meanOf(bundles),
    feed: (sw): void => projection.feed(name, sw)
  };

  leaving.feeding = feeding;
  feeding.feed({ from: feeding.from, to: feeding.to, progress: feeding.fed / WHOLE });
}

/**
 * Feeds the loader a new switch when the progress moved by a step since the last feed; below the step it only reads
 * numbers.
 *
 * @param feeding - What the switch feeds.
 */
function feedStep(feeding: LoaderFeed): void {
  const now = meanOf(feeding.bundles);

  if (!isStep(feeding.fed, now)) return;

  feeding.fed = now;
  feeding.feed({ from: feeding.from, to: feeding.to, progress: now / WHOLE });
}

/**
 * Counts one settled file of a bundle of the running switch, from the `assets:bundle-progress` hook: the bundle's share
 * is set, and the loader is fed when the progress moved by a step. With no switch (none runs, or it swapped or
 * dropped: `endLeave` takes it out of the state), no loader fed, or a bundle the switch does not name, nothing happens.
 * Below the step it reads and writes numbers only: no allocation.
 *
 * @param state - The plugin state.
 * @param bundle - The bundle the event names.
 * @param loaded - Its settled files.
 * @param total - Its files.
 */
export function countProgress(state: State, bundle: string, loaded: number, total: number): void {
  const feeding = state.leaving?.feeding;

  if (feeding === undefined) return;

  const row = rowOf(feeding.bundles, bundle);

  if (row === undefined) return;

  row.share = shareOf(loaded, total);
  feedStep(feeding);
}

/**
 * Counts every bundle of the running switch whole once the scene stage has its loads in: a bundle with no file, which
 * sends no progress, counts then, and the loader reads 1 before the warm and the build. With no loader fed, nothing
 * happens.
 *
 * @param state - The plugin state.
 */
export function countLoaded(state: State): void {
  const feeding = state.leaving?.feeding;

  if (feeding === undefined) return;

  for (const row of feeding.bundles) row.share = WHOLE;

  feedStep(feeding);
}

/**
 * Feeds a loader scenes holds the switch of the scene that stands, right after the hold: `world` keeps the first
 * value fed after a hold for the view it builds ahead, so the loader is built for `{ from: current, to: current,
 * progress: 0 }` and not for the last switch.
 *
 * @param ctx - Domain context of the plugin.
 * @param name - The loader held.
 */
export function feedStanding(ctx: ScenesCtx, name: string): void {
  const scene = ctx.state.current;

  if (scene === undefined) return;

  ctx.deps.world.projection.feed(name, { from: scene, to: scene, progress: 0 });
}
