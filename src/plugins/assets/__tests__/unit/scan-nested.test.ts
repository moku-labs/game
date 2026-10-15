import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ScanResult, scanAssets } from "../../scan/scan";
import { makeTree, pngBytes, removeTree } from "./scan-fixtures";

// ---------------------------------------------------------------------------
// The scanner over nested feature owners, on temp trees. Owners come from the
// real `findFeatureOwners` of `src/project/features.ts`: a folder inside a
// feature is a sub-feature when it has a door and resources of its own.
// ---------------------------------------------------------------------------

/** The door of a sub-feature: the scanner never reads it, it only has to be there. */
const DOOR = "export {};\n";

const roots: string[] = [];

/**
 * Writes a temp game tree and remembers it for the cleanup.
 *
 * @param files - POSIX path to its bytes or text.
 * @returns The root of the tree.
 */
async function tree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await makeTree(files);

  roots.push(root);

  return root;
}

/**
 * Scans a tree into `out/` under it.
 *
 * @param root - The game root.
 * @param extra - The features folder, the layers and whether to write.
 * @param extra.features - The features folder, when it is not `features`.
 * @param extra.write - True to write the outputs.
 * @param extra.layers - The layer map.
 * @returns What the scan produced.
 */
async function scan(
  root: string,
  extra: { features?: string; write?: boolean; layers?: Readonly<Record<string, string>> } = {}
): Promise<ScanResult> {
  return await scanAssets({
    root,
    manifest: path.join(root, "out", "manifest.json"),
    keys: path.join(root, "out", "generated", "assets.ts"),
    write: extra.write ?? false,
    ...(extra.features === undefined ? {} : { features: extra.features }),
    ...(extra.layers === undefined ? {} : { layers: extra.layers })
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("scanAssets over nested owners", () => {
  it("keys a sub-feature's file by its own name and records its parent and folder", async () => {
    const root = await tree({
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/ward/room.png": pngBytes(256, 128)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ep01).toEqual({
      feature: "ep01",
      parent: "episodes",
      dir: "features/episodes/ep01",
      tier: "feature",
      mb: 0.125,
      files: [
        {
          key: "ep01.ward.room",
          path: "features/episodes/ep01/assets/ward/room.png",
          width: 256,
          height: 128,
          mb: 0.125
        }
      ]
    });
  });

  it("keeps the parent's assets in its own bundle and the child's out of it", async () => {
    const root = await tree({
      "features/episodes/index.ts": DOOR,
      "features/episodes/assets/cover.png": pngBytes(64, 64),
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/cover.png": pngBytes(64, 64)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.episodes?.files.map(file => file.key)).toEqual(["episodes.cover"]);
    expect(manifest.bundles.episodes).not.toHaveProperty("parent");
    expect(manifest.bundles.ep01?.files.map(file => file.key)).toEqual(["ep01.cover"]);
  });

  it("records the immediate parent of a sub-feature two levels down", async () => {
    const root = await tree({
      "features/a/b/index.ts": DOOR,
      "features/a/b/strings/en.json": "{}",
      "features/a/b/c/index.ts": DOOR,
      "features/a/b/c/assets/x.png": pngBytes(8, 8)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.c).toMatchObject({ feature: "c", parent: "b", dir: "features/a/b/c" });
    expect(manifest.bundles.b).toMatchObject({ feature: "b", parent: "a", dir: "features/a/b" });
  });

  it("drafts a file-less bundle for a strings-only sub-feature, and none for a flat feature without files", async () => {
    const root = await tree({
      "features/home/strings/en.json": "{}",
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep02/index.ts": DOOR,
      "features/episodes/ep02/strings/en.json": "{}"
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles).toEqual({
      ep02: {
        feature: "ep02",
        parent: "episodes",
        dir: "features/episodes/ep02",
        tier: "feature",
        mb: 0,
        files: []
      }
    });
  });

  it("drafts no bundle for a code-only sub-feature, also when its parent's door lists it", async () => {
    const root = await tree({
      "features/episodes/index.ts":
        'import { notesFeature } from "./notes";\n' +
        'export const episodesFeature = defineFeature("episodes", { features: [notesFeature] });\n',
      "features/episodes/assets/cover.png": pngBytes(8, 8),
      "features/episodes/notes/index.ts": DOOR,
      "features/episodes/notes/views/x.ts": DOOR
    });

    const { manifest } = await scan(root);

    expect(Object.keys(manifest.bundles)).toEqual(["episodes"]);
  });

  it("fails on one feature name in two folders, naming both, and writes nothing", async () => {
    const root = await tree({
      "features/episodes/kit/index.ts": DOOR,
      "features/episodes/kit/assets/a.png": pngBytes(8, 8),
      "features/minigames/kit/index.ts": DOOR,
      "features/minigames/kit/assets/b.png": pngBytes(8, 8)
    });

    const failure = scan(root, { write: true });

    await expect(failure).rejects.toThrow("the scan found 1 problem.");
    await expect(failure).rejects.toThrow(/features\/episodes\/kit and features\/minigames\/kit/);
    await expect(access(path.join(root, "out", "manifest.json"))).rejects.toThrow();
  });

  it("lets a sub-feature declare only its own name, and its parent not the child's", async () => {
    const child = await tree({
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets.ts":
        'export const a = { kind: "bundles", map: { "episodes.ep01": { tier: "lazy" } } };\n'
    });
    const parent = await tree({
      "features/episodes/index.ts": DOOR,
      "features/episodes/assets.ts":
        'export const a = { kind: "bundles", map: { ep01: { tier: "lazy" } } };\n',
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/a.png": pngBytes(8, 8)
    });

    await expect(scan(child)).rejects.toThrow(
      'the feature "ep01" declares the bundle "episodes.ep01", which is neither "ep01" nor a name starting with "ep01.".'
    );
    await expect(scan(parent)).rejects.toThrow(
      'the feature "episodes" declares the bundle "ep01", which is neither "episodes" nor a name starting with "episodes.".'
    );
  });

  it("refuses a layer mapped to the name of a sub-feature", async () => {
    const root = await tree({
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/a.png": pngBytes(8, 8),
      "shared/assets/b.png": pngBytes(8, 8)
    });

    await expect(scan(root, { layers: { shared: "ep01" } })).rejects.toThrow(
      'the layer "shared" is mapped to "ep01", which is also a feature folder: their keys and bundles would merge.'
    );
  });

  it("notes a child folder with assets but no door, and keys none of its files", async () => {
    const root = await tree({
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep03/assets/a.png": pngBytes(8, 8)
    });

    const { manifest, notes } = await scan(root);

    expect(manifest.bundles).toEqual({});
    expect(notes).toEqual([
      'the folder "features/episodes/ep03" has assets but is no feature: its files are not in the manifest. A sub-feature needs a door index.ts.'
    ]);
  });

  it("reads the owners of a custom features folder, a nested one included", async () => {
    const root = await tree({
      "parts/board/assets/cell.png": pngBytes(8, 8),
      "parts/episodes/ep01/index.ts": DOOR,
      "parts/episodes/ep01/assets/a.png": pngBytes(8, 8)
    });

    const { manifest } = await scan(root, { features: "parts" });

    expect(manifest.bundles.board?.files[0]?.path).toBe("parts/board/assets/cell.png");
    expect(manifest.bundles.ep01).toMatchObject({ parent: "episodes", dir: "parts/episodes/ep01" });
  });
});

describe("scanAssets on a flat game", () => {
  // The mini game's assets.ts imports the engine through its kit: the first import takes seconds.
  it("writes the committed manifest and key module of the mini game byte for byte", {
    timeout: 90_000
  }, async () => {
    // The manifest of a game without sub-features carries no `parent`, `dir`, `release` or `mips`:
    // `moku-game keys --check` stays green right after the engine update.
    const root = path.resolve("tests/fixtures/mini-game");
    const result = await scanAssets({
      root,
      manifest: path.join(root, "generated", "manifest.json"),
      keys: path.join(root, "generated", "assets.ts"),
      write: false
    });

    expect(result.changed).toBe(false);
    expect(await readFile(path.join(root, "generated", "manifest.json"), "utf8")).not.toMatch(
      /"(?:parent|dir|release|mips)"/
    );
  });
});
