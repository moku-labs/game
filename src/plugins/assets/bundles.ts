/**
 * @file assets plugin — the two authoring helpers. Pure: they produce plain data, so a game
 * imports them from the package root and a node writes `await fx(load("board.chains"))`.
 */
import type { Descriptor } from "../flow/types";
import type { BundleMap, BundleSpec, DefineBundles, LoadBundles } from "./types";

/**
 * Declares the bundles of one feature. The map is copied, so a later change of the caller's
 * object cannot reach the scanner or the plugin. `defineGame` returns this helper typed by the
 * game's `BundleKey`, so a name the scanner never saw does not compile.
 *
 * @param map - Bundle name to its tier and, when it is a split bundle, its globs.
 * @returns The bundle map as plain data.
 * @example
 * ```ts
 * // features/board/assets.ts of a game: the board is a scene bundle, the chains load on demand.
 * export const boardAssets = defineBundles({
 *   board: { tier: "scene" },
 *   "board.chains": { tier: "lazy", files: ["chains/*.png"] }
 * });
 * ```
 */
export function defineBundles<Key extends string>(
  map: Partial<Record<Key, BundleSpec>>
): BundleMap<Key> {
  const copy: Partial<Record<Key, BundleSpec>> = {};

  for (const [name, value] of Object.entries(map)) {
    const spec = value as BundleSpec | undefined;

    if (spec === undefined) continue;

    copy[name as Key] =
      spec.files === undefined ? { tier: spec.tier } : { tier: spec.tier, files: [...spec.files] };
  }

  return { kind: "bundles", map: copy };
}

/**
 * Creates the awaited effect that loads one or more bundles. The handler of the kind `"load"` is
 * registered by this plugin and runs in fast mode too, so a fast walk really loads.
 *
 * @param bundle - One bundle name, or a list of them in load order.
 * @returns The descriptor a loading node awaits.
 * @example
 * ```ts
 * // A loading node of a game: one bundle per turn, so the screen can draw progress.
 * await fx(load("board.chains")); // { loaded: ["board.chains"], mb: 1.25 }
 * await fx(load(["board", "ui"])); // both, in that order
 * ```
 */
export function load(bundle: string | readonly string[]): Descriptor {
  const bundles = typeof bundle === "string" ? [bundle] : [...bundle];

  return { kind: "load", payload: { bundles } };
}

/**
 * Binds `defineBundles` and `load` to one game's bundle keys. Type-only: the same functions.
 *
 * @returns The two helpers whose keys are checked by the compiler.
 * @example
 * ```ts
 * const { load } = bundlesFor<"board" | "board.chains">();
 * load("board.chains"); // { kind: "load", payload: { bundles: ["board.chains"] } }
 * ```
 */
export function bundlesFor<Bundle extends string>(): {
  defineBundles: DefineBundles<Bundle>;
  load: LoadBundles<Bundle>;
} {
  return { defineBundles, load };
}
