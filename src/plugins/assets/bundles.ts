/**
 * @file assets plugin — the authoring helpers. Pure: they produce plain data, so a game imports
 * them from the package root and a node writes `await fx(load("board.chains"))`.
 */
import type { Descriptor } from "../flow/types";
import type {
  BundleMap,
  BundleSpec,
  DefineBundles,
  LoadBundles,
  LoadResult,
  ReadyBundles
} from "./types";

/**
 * Copies one bundle spec, its lists too, so the copy shares nothing with the caller's object.
 *
 * @param spec - What the feature declared for one bundle.
 * @returns The copy, without the keys the spec left out.
 */
function copySpec(spec: BundleSpec): BundleSpec {
  const mipmaps = spec.mipmaps;

  return {
    tier: spec.tier,
    ...(spec.files === undefined ? {} : { files: [...spec.files] }),
    ...(spec.release === undefined ? {} : { release: spec.release }),
    ...(mipmaps === undefined ? {} : { mipmaps: Array.isArray(mipmaps) ? [...mipmaps] : mipmaps })
  };
}

/**
 * Declares the bundles of one feature. The map is copied, so a later change of the caller's
 * object cannot reach the scanner or the plugin. `defineGame` returns this helper typed by the
 * game's `BundleKey`, so a name the scanner never saw does not compile.
 *
 * @param map - Bundle name to its tier and, when it is a split bundle, its globs; its release
 *   and its mipmaps when it declares them.
 * @returns The bundle map as plain data.
 * @example
 * ```ts
 * // features/board/assets.ts of a game: the board is a scene bundle, the chains load on demand
 * // and leave with the board.
 * export const boardAssets = defineBundles({
 *   board: { tier: "scene" },
 *   "board.chains": { tier: "lazy", files: ["chains/*.png"], release: "leave" }
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

    copy[name as Key] = copySpec(spec);
  }

  return { kind: "bundles", map: copy };
}

/**
 * Creates the awaited effect that loads one or more bundles. The handler of the kind `"load"` is
 * registered by this plugin and runs in fast mode too, so a fast walk really loads. It resolves
 * `undefined` in an app without `assets`, such as the headless app of `game.headless()`.
 *
 * @param bundle - One bundle name, or a list of them in load order.
 * @returns The descriptor a loading node awaits.
 * @example
 * ```ts
 * // A loading node of a game: one bundle per turn, so the screen can draw progress.
 * const loaded = await fx(load("board.chains")); // { loaded: ["board.chains"], mb: 1.25 }
 * // undefined in an app without assets, such as the headless app of game.headless()
 * await fx(load(["board", "ui"])); // both, in that order
 * ```
 */
export function load(bundle: string | readonly string[]): Descriptor<LoadResult | undefined> {
  const bundles = typeof bundle === "string" ? [bundle] : [...bundle];

  return { kind: "load", payload: { bundles } };
}

/**
 * Creates the effect a node awaits to rest on bundles and stay answerable (F52). The handler of the
 * kind `"ready"` is registered by this plugin and runs in fast mode too. It answers `true` when every
 * bundle is loaded and its textures went to the GPU (`assets.warm`), or its last load failed, so a
 * node never hangs on it. Otherwise it starts what is missing, answers `false`, and posts the world
 * event `ready` into `flow.inbox` once all of it settled: the node rests on `inbox: ["ready"]`
 * meanwhile, and Back still answers. A headless `assets` answers `true`; an app without `assets`,
 * such as the headless app of `game.headless()`, resolves `undefined`, hence `=== false`. A name
 * the manifest lacks throws, as for `load`.
 *
 * @param bundle - One bundle name, or a list of them.
 * @returns The descriptor a transit node awaits.
 * @example
 * ```ts
 * ready("ep01.memory"); // { kind: "ready", payload: { bundles: ["ep01.memory"] } }
 * // The transit node in front of the rest node `wait` (inbox: ["elapsed", "ready"]):
 * if ((await fx(ready(["ep01.memory", "ui"]))) === false) return out.wait(); // false: still loading
 * return out.open(); // true: loaded and on the GPU
 * ```
 */
export function ready(bundle: string | readonly string[]): Descriptor<boolean | undefined> {
  const bundles = typeof bundle === "string" ? [bundle] : [...bundle];

  return { kind: "ready", payload: { bundles } };
}

/**
 * Binds `defineBundles`, `load` and `ready` to one game's bundle keys. Type-only: the same
 * functions.
 *
 * @returns The three helpers whose keys are checked by the compiler.
 * @example
 * ```ts
 * const { load, ready } = bundlesFor<"board" | "board.chains">();
 * load("board.chains"); // { kind: "load", payload: { bundles: ["board.chains"] } }
 * ready("board"); // { kind: "ready", payload: { bundles: ["board"] } }
 * ```
 */
export function bundlesFor<Bundle extends string>(): {
  defineBundles: DefineBundles<Bundle>;
  load: LoadBundles<Bundle>;
  ready: ReadyBundles<Bundle>;
} {
  return { defineBundles, load, ready };
}
