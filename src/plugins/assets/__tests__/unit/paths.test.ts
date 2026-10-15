import { describe, expect, it } from "vitest";
import { indexPaths, refusalOf } from "../../paths";
import type { AssetStamps, Manifest, ManifestFile } from "../../types";

// ---------------------------------------------------------------------------
// The hot-swap path check: a changed path the manifest does not know is a new
// asset when it lies under a bundle's `assets/` folder, or under the `assets/`
// of a new owner of a folder that holds owners (a home), at any depth.
// ---------------------------------------------------------------------------

/**
 * Builds one texture file of a bundle.
 *
 * @param key - Its asset key.
 * @param path - Its root-relative path.
 * @returns The file.
 */
function file(key: string, path: string): ManifestFile {
  return { key, path, width: 8, height: 8, mb: 0 };
}

/** A flat feature `episodes` with one file, and its sub-feature `ep01` with `dir` and no file. */
const nested: Manifest = {
  version: 1,
  bundles: {
    episodes: {
      feature: "episodes",
      tier: "feature",
      mb: 0,
      files: [file("episodes.cover", "features/episodes/assets/cover.png")]
    },
    ep01: {
      feature: "ep01",
      parent: "episodes",
      dir: "features/episodes/ep01",
      tier: "lazy",
      mb: 0,
      files: []
    }
  }
};

/**
 * The stamp after a save of one new file, next to every file the manifest names.
 *
 * @param manifest - The manifest the page booted with.
 * @param path - The saved path.
 * @returns The stamp.
 */
function savedNew(manifest: Manifest, path: string): AssetStamps {
  const known = Object.values(manifest.bundles).flatMap(entry =>
    entry.files.map(entryFile => entryFile.path ?? "")
  );

  return {
    files: { ...Object.fromEntries(known.map(entryPath => [entryPath, "100:1"])), [path]: "200:2" },
    changed: [path]
  };
}

/**
 * Asks the check about one saved path.
 *
 * @param manifest - The manifest the page booted with.
 * @param path - The saved path.
 * @returns The refusal, or `undefined`.
 */
function refusal(manifest: Manifest, path: string): string | undefined {
  const stamps = savedNew(manifest, path);

  return refusalOf(indexPaths(manifest), stamps, stamps.changed);
}

describe("refusalOf with owner folders", () => {
  it("refuses the first file of a sub-feature whose bundle has a dir and no file", () => {
    const path = "features/episodes/ep01/assets/ward/room.png";

    expect(refusal(nested, path)).toBe(`"${path}" is not in the manifest`);
  });

  it("refuses the first file of a new sub-feature next to a known one, also when the parent has no bundle", () => {
    const { ep01 } = nested.bundles;
    const childOnly: Manifest = { version: 1, bundles: ep01 === undefined ? {} : { ep01 } };
    const path = "features/episodes/ep03/assets/a.png";

    expect(refusal(nested, path)).toBe(`"${path}" is not in the manifest`);
    expect(refusal(childOnly, path)).toBe(`"${path}" is not in the manifest`);
  });

  it("refuses nothing for an image outside every assets folder", () => {
    expect(refusal(nested, "features/episodes/icon.png")).toBeUndefined();
  });

  it("derives the folder of a file-less flat bundle as features/<feature>", () => {
    // No file says where `board` lives: its home is the default features folder, so the first
    // file of a sub-feature under it is new.
    const flat: Manifest = {
      version: 1,
      bundles: { board: { feature: "board", tier: "scene", mb: 0, files: [] } }
    };
    const path = "features/board/bonus/assets/a.png";

    expect(refusal(flat, path)).toBe(`"${path}" is not in the manifest`);
  });

  it("still refuses a new file next to a known one of an old manifest without dir", () => {
    const old: Manifest = {
      version: 1,
      bundles: {
        shop: {
          feature: "shop",
          tier: "scene",
          mb: 0,
          files: [file("shop.icons.coin", "features/shop/assets/icons/coin.png")]
        }
      }
    };
    const path = "features/shop/assets/banner.png";

    expect(refusal(old, path)).toBe(`"${path}" is not in the manifest`);
  });
});
