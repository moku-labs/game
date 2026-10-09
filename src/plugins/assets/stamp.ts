/**
 * @file assets plugin — the stamp of the keys watch. `moku-game dev` stamps every asset file of
 * the game into `.moku/assets-stamp.ts`, and `ui` forwards the new exports of that module on the
 * global `ui:hot-swap`. This file tells the stamp from any other module and works out which files
 * it changed; `swap.ts` replaces them.
 */
import type { AssetStamps, HotSwap, State } from "./types";

/** The module the keys watch writes, as the hot footer reports its path. */
const STAMP_FILE = "/.moku/assets-stamp.ts";

/**
 * Tells whether a value maps paths to stamps.
 *
 * @param value - The `files` member of a stamp module.
 * @returns True for a plain object whose values are all strings.
 * @example
 * ```ts
 * isStampMap({ "features/ui/assets/fx-spark.webp": "2554:1791536552578" }); // true
 * ```
 */
function isStampMap(value: unknown): value is AssetStamps["files"] {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(stamp => typeof stamp === "string")
  );
}

/**
 * Tells whether a value is a list of paths.
 *
 * @param value - The `changed` member of a stamp module.
 * @returns True for an array of strings.
 * @example
 * ```ts
 * isPathList(["features/ui/assets/fx-spark.webp"]); // true
 * ```
 */
function isPathList(value: unknown): value is AssetStamps["changed"] {
  return Array.isArray(value) && value.every(path => typeof path === "string");
}

/**
 * Tells the stamp of the keys watch from any other default export.
 *
 * @param value - The default export of the stamp module.
 * @returns True when it carries a `files` map of strings and a `changed` list of strings.
 * @example
 * ```ts
 * isAssetStamps({ files: { "features/ui/assets/popup.mp3": "8120:1791536000000" }, changed: [] }); // true
 * ```
 */
export function isAssetStamps(value: unknown): value is AssetStamps {
  if (typeof value !== "object" || value === null) return false;
  if (!("files" in value) || !("changed" in value)) return false;

  return isStampMap(value.files) && isPathList(value.changed);
}

/**
 * Reads the stamp out of a hot swap, when the saved module is the stamp of the keys watch.
 *
 * @param payload - The saved file and its new exports.
 * @returns The stamp, or `undefined` for any other file and for a module that carries none.
 * @example
 * ```ts
 * stampsOf({ file: "/game/features/hud/view.tsx", module: {} }); // undefined
 * ```
 */
export function stampsOf(payload: HotSwap): AssetStamps | undefined {
  if (!payload.file.replaceAll("\\", "/").endsWith(STAMP_FILE)) return undefined;

  const stamps = payload.module.default;

  return isAssetStamps(stamps) ? stamps : undefined;
}

/**
 * Works out which files a stamp changed, and keeps its map for the next one. Against the map
 * applied last it is every path whose stamp differs. The first update after boot has no map to
 * compare with, so the list of the keys watch stands.
 *
 * @param state - The plugin state.
 * @param stamps - The stamp that arrived.
 * @returns The changed paths.
 */
export function changedPaths(state: State, stamps: AssetStamps): readonly string[] {
  const applied = state.stamps;

  state.stamps = stamps.files;

  if (applied === undefined) return stamps.changed;

  return Object.keys(stamps.files).filter(path => stamps.files[path] !== applied[path]);
}
