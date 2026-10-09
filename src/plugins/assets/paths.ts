/**
 * @file assets plugin — the paths of the manifest, for the dev hot swap. A stamp names files by
 * path; this file leads a path to its file and bundle, tells why a stamp cannot be swapped in
 * place (the set of files changed, so the page reloads) and groups the changed files by bundle.
 * Pure functions over the manifest the page booted with.
 */
import type { AssetStamps, Manifest, ManifestBundle, ManifestFile } from "./types";

/** The name of the folder of a feature or of a layer the scanner reads. */
const ASSETS = "assets";

/** That folder inside a path. */
const ASSETS_FOLDER = `/${ASSETS}/`;

/**
 * The file a manifest path leads to: its record, its own path and its bundle. The pages of a font
 * lead to the font, so the `.fnt` and every page share one owner.
 */
export type Owner = { bundle: string; entry: ManifestBundle; file: ManifestFile; path: string };

/** The changed files of one bundle: what one `assets:replaced` reports. */
export type Batch = { bundle: string; entry: ManifestBundle; owners: Owner[] };

/** The paths of one manifest: the owner of each, and the folders the scanner read them from. */
export type PathIndex = {
  manifest: Manifest;
  owners: Map<string, Owner>;
  folders: readonly string[];
};

/**
 * Reads the folder the scanner found a manifest path in. The scanner reads the `assets/` folder
 * of a feature or of a layer, so the path is cut after it; a path with no such folder, as in a
 * manifest written by hand, gives the folder of the file.
 *
 * @param path - A path of the manifest.
 * @returns The folder, ending in a slash, or `""` for a file at the root.
 * @example
 * ```ts
 * folderOf("features/ui/assets/fx/leaf.webp"); // "features/ui/assets/"
 * ```
 */
function folderOf(path: string): string {
  const scanned = path.indexOf(ASSETS_FOLDER);

  if (scanned !== -1) return path.slice(0, scanned + ASSETS_FOLDER.length);

  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Tells whether the scanner would read a path, by its shape alone. It mirrors `scanOwner` of
 * `scan/scan.ts`, which runtime code does not import: the scanner reads `<layer>/assets/` and
 * `<features>/<feature>/assets/` under the game root, so `assets` is the second or the third
 * segment and a file follows it. The page knows neither the layers nor the name of the features
 * folder, so any folder counts as one. This is what finds the first file of an `assets/` folder
 * the booted manifest names nowhere.
 *
 * @param path - A path of the game, root-relative with `/`.
 * @returns True for a path under the `assets/` of a layer or of a feature.
 * @example
 * ```ts
 * isScannerPath("features/shop/assets/coin.png"); // true
 * ```
 */
function isScannerPath(path: string): boolean {
  const segments = path.split("/");
  const inLayer = segments[1] === ASSETS && segments.length > 2;
  const inFeature = segments[2] === ASSETS && segments.length > 3;

  return inLayer || inFeature;
}

/**
 * Builds the path index of a manifest: which file and bundle every path leads to, and the folders
 * the scanner read. A path under one of those folders that leads nowhere is a new asset.
 *
 * @param manifest - The manifest the page booted with.
 * @returns The index.
 */
export function indexPaths(manifest: Manifest): PathIndex {
  const owners = new Map<string, Owner>();
  const folders = new Set<string>();

  for (const [bundle, entry] of Object.entries(manifest.bundles)) {
    for (const file of entry.files) {
      // A texture packed in an atlas has no path: it is cut out of a page, and a pack is not watched.
      if (file.path === undefined) continue;

      const owner: Owner = { bundle, entry, file, path: file.path };

      for (const path of [file.path, ...(file.pages ?? []).map(page => page.path)]) {
        owners.set(path, owner);
        folders.add(folderOf(path));
      }
    }
  }

  // A file at the root has no folder, and the empty prefix would claim every image of the game.
  folders.delete("");

  return { manifest, owners, folders: [...folders] };
}

/**
 * Tells why a stamp cannot be swapped in place: the set of files is not the one of the manifest
 * the page booted with. A manifest path the watch no longer stamps was removed or renamed, or its
 * nine-slice tag changed. A changed path the manifest does not know is a new asset when it lies
 * under a folder the manifest names, or where the scanner reads: the first file of an `assets/`
 * folder that had none counts too. The watch stamps every image of the game tree, so any other
 * unknown path (a favicon, an image of a feature outside its `assets/`) refuses nothing.
 *
 * @param index - The path index of the manifest.
 * @param stamps - The stamp that arrived.
 * @param changed - The paths whose bytes changed.
 * @returns The reason, or `undefined` when only bytes changed.
 */
export function refusalOf(
  index: PathIndex,
  stamps: AssetStamps,
  changed: readonly string[]
): string | undefined {
  for (const path of index.owners.keys()) {
    if (!Object.hasOwn(stamps.files, path)) return `"${path}" left the game`;
  }

  for (const path of changed) {
    if (index.owners.has(path)) continue;

    const isNew = isScannerPath(path) || index.folders.some(folder => path.startsWith(folder));

    if (isNew) return `"${path}" is not in the manifest`;
  }

  return undefined;
}

/**
 * Groups the changed files by their bundle. A font whose `.fnt` and pages changed in one save is
 * listed once: a font is replaced as a whole. A path the manifest does not know is left out.
 *
 * @param index - The path index of the manifest.
 * @param changed - The paths whose bytes changed.
 * @returns One batch per bundle, in the order the paths name them.
 */
export function batchesOf(index: PathIndex, changed: readonly string[]): Batch[] {
  const batches = new Map<string, Batch>();

  for (const path of changed) {
    const owner = index.owners.get(path);

    if (owner === undefined) continue;

    const { bundle, entry } = owner;
    const batch = batches.get(bundle) ?? { bundle, entry, owners: [] };

    if (!batch.owners.includes(owner)) batch.owners.push(owner);

    batches.set(bundle, batch);
  }

  return [...batches.values()];
}
