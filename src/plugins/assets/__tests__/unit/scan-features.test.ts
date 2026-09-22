import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ScanResult, scanAssets } from "../../scan/scan";
import { makeTree, pngBytes, removeTree, webpVp8Bytes } from "./scan-fixtures";

const roots: string[] = [];

async function tree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await makeTree(files);

  roots.push(root);

  return root;
}

function manifestPath(root: string): string {
  return path.join(root, "out", "manifest.json");
}

function keysPath(root: string): string {
  return path.join(root, "out", "generated", "assets.ts");
}

async function scan(
  root: string,
  extra?: { features?: string; write?: boolean }
): Promise<ScanResult> {
  return await scanAssets({
    root,
    manifest: manifestPath(root),
    keys: keysPath(root),
    write: extra?.write ?? false,
    ...(extra?.features === undefined ? {} : { features: extra.features })
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("scanAssets", () => {
  it("makes one feature-tier bundle out of a feature without assets.ts", async () => {
    const root = await tree({
      "features/board/assets/item-a-1.png": pngBytes(64, 64),
      "features/board/assets/cell.png": pngBytes(64, 64)
    });

    const { manifest } = await scan(root);

    expect(manifest.version).toBe(1);
    expect(manifest.bundles.board).toEqual({
      feature: "board",
      tier: "feature",
      mb: 0.032,
      files: [
        {
          key: "board.cell",
          path: "features/board/assets/cell.png",
          width: 64,
          height: 64,
          mb: 0.016
        },
        {
          key: "board.item-a-1",
          path: "features/board/assets/item-a-1.png",
          width: 64,
          height: 64,
          mb: 0.016
        }
      ]
    });
  });

  it("keys a nested folder and a WebP file", async () => {
    const root = await tree({
      "features/ui/assets/button/primary.png": pngBytes(128, 128),
      "features/reward-popup/assets/star-on.webp": webpVp8Bytes(32, 32)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files[0]?.key).toBe("ui.button.primary");
    expect(manifest.bundles["reward-popup"]?.files[0]).toEqual({
      key: "reward-popup.star-on",
      path: "features/reward-popup/assets/star-on.webp",
      width: 32,
      height: 32,
      mb: 0.004
    });
  });

  it("moves a nine tag into the metadata and out of the key", async () => {
    const root = await tree({
      "features/ui/assets/panel{nine=48}.png": pngBytes(256, 128)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files[0]).toEqual({
      key: "ui.panel",
      path: "features/ui/assets/panel{nine=48}.png",
      width: 256,
      height: 128,
      mb: 0.125,
      nine: { left: 48, top: 48, right: 48, bottom: 48 }
    });
  });

  it("writes the four sides of a {nine=L,T,R,B} tag and fits them side by side", async () => {
    // 40 + 10 is below the width 64, although 40 alone is more than half of it.
    const root = await tree({
      "features/ui/assets/sign{nine=40,4,10,6}.png": pngBytes(64, 32)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files[0]).toMatchObject({
      key: "ui.sign",
      nine: { left: 40, top: 4, right: 10, bottom: 6 }
    });
  });

  it("keeps a file with a malformed tag under its whole name and notes it once", async () => {
    const root = await tree({
      "features/ui/assets/panel{nine=4,5,6}.png": pngBytes(64, 64)
    });

    const { manifest, notes } = await scan(root);

    expect(manifest.bundles.ui?.files[0]).toEqual({
      key: "ui.panel{nine=4,5,6}",
      path: "features/ui/assets/panel{nine=4,5,6}.png",
      width: 64,
      height: 64,
      mb: 0.016
    });
    expect(notes).toEqual([
      'kept the whole name of "features/ui/assets/panel{nine=4,5,6}.png": the tag ' +
        '"{nine=4,5,6}" is not {nine=N}, {nine=H,V} or {nine=L,T,R,B}.'
    ]);
  });

  it("notes a malformed tag on a sound as well", async () => {
    const root = await tree({ "features/ui/assets/click{nine}.mp3": "ID3" });

    const { manifest, notes } = await scan(root);

    expect(manifest.bundles.ui?.files[0]?.key).toBe("ui.click{nine}");
    expect(notes).toHaveLength(1);
  });

  it("reads the features folder the options name", async () => {
    const root = await tree({ "parts/ui/assets/panel.png": pngBytes(16, 16) });

    const { manifest } = await scan(root, { features: "parts" });

    expect(manifest.bundles.ui?.files[0]?.path).toBe("parts/ui/assets/panel.png");
  });

  it("ignores a file that is neither PNG nor WebP and says so in a note", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/notes.md": "how the panel was drawn"
    });

    const { manifest, notes } = await scan(root);

    expect(notes).toEqual([
      'ignored "features/ui/assets/notes.md": the scanner reads .png, .webp, .fnt and .mp3 only.'
    ]);
    expect(manifest.bundles.ui?.files).toHaveLength(1);
  });

  it("is empty when the features folder is missing", async () => {
    const root = await tree({ "readme.md": "no features yet" });

    const { manifest, notes } = await scan(root);

    expect(manifest).toEqual({ version: 1, bundles: {} });
    expect(notes).toEqual([]);
  });

  it("skips a feature without an assets folder", async () => {
    const root = await tree({
      "features/rules/index.ts": "export const rules = 1;\n",
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    const { manifest } = await scan(root);

    expect(Object.keys(manifest.bundles)).toEqual(["ui"]);
  });

  it("splits the files of a feature over the bundles of its assets.ts", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { board: { tier: "scene" },' +
        ' "board.chains": { tier: "lazy", files: ["chains/*.png"] } } };\n',
      "features/board/assets/cell.png": pngBytes(64, 64),
      "features/board/assets/chains/link.png": pngBytes(32, 32)
    });

    const { manifest } = await scan(root);

    expect(Object.keys(manifest.bundles)).toEqual(["board", "board.chains"]);
    expect(manifest.bundles.board?.tier).toBe("scene");
    expect(manifest.bundles.board?.files.map(file => file.key)).toEqual(["board.cell"]);
    expect(manifest.bundles["board.chains"]).toEqual({
      feature: "board",
      tier: "lazy",
      mb: 0.004,
      files: [
        {
          key: "board.chains.link",
          path: "features/board/assets/chains/link.png",
          width: 32,
          height: 32,
          mb: 0.004
        }
      ]
    });
  });

  it("reads a named export and keeps a declared bundle that matched no file", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export const version = 2;\nexport const boardAssets = { kind: "bundles",' +
        ' map: { "board.chains": { tier: "lazy", files: ["chains/**/*.png"] } } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    const { manifest } = await scan(root);

    expect(Object.keys(manifest.bundles)).toEqual(["board", "board.chains"]);
    expect(manifest.bundles["board.chains"]).toEqual({
      feature: "board",
      tier: "lazy",
      mb: 0,
      files: []
    });
    expect(manifest.bundles.board?.tier).toBe("feature");
  });

  it("matches a glob with ? and a deep **", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { "board.a": { tier: "lazy", files: ["item-?.png"] },' +
        ' "board.b": { tier: "lazy", files: ["deep/**"] } } };\n',
      "features/board/assets/item-a.png": pngBytes(16, 16),
      "features/board/assets/deep/one/two.png": pngBytes(16, 16),
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles["board.a"]?.files.map(file => file.key)).toEqual(["board.item-a"]);
    expect(manifest.bundles["board.b"]?.files.map(file => file.key)).toEqual([
      "board.deep.one.two"
    ]);
    expect(manifest.bundles.board?.files.map(file => file.key)).toEqual(["board.cell"]);
  });

  it("sorts bundles by name and files by key", async () => {
    const root = await tree({
      "features/ui/assets/z.png": pngBytes(16, 16),
      "features/ui/assets/a.png": pngBytes(16, 16),
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    const { manifest } = await scan(root);

    expect(Object.keys(manifest.bundles)).toEqual(["board", "ui"]);
    expect(manifest.bundles.ui?.files.map(file => file.key)).toEqual(["ui.a", "ui.z"]);
  });
});

describe("scanAssets outputs", () => {
  it("writes both files, makes their folders and reports the change", async () => {
    const root = await tree({ "features/ui/assets/panel{nine=48}.png": pngBytes(256, 128) });

    const { changed, keysSource } = await scan(root, { write: true });

    expect(changed).toBe(true);
    expect(keysSource).toContain('export type AssetKey =\n  | "ui.panel";');
    expect(await readFile(manifestPath(root), "utf8")).toContain('"ui.panel"');
    expect(await readFile(keysPath(root), "utf8")).toBe(keysSource);
  });

  it("writes the same bytes twice and reports no change on the second run", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    const first = await scan(root, { write: true });
    const written = await readFile(manifestPath(root), "utf8");
    const second = await scan(root, { write: true });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await readFile(manifestPath(root), "utf8")).toBe(written);
  });

  it("reports the change without writing when write is false", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    const { changed } = await scan(root, { write: false });

    expect(changed).toBe(true);
    await expect(readFile(manifestPath(root), "utf8")).rejects.toThrow();
  });
});

describe("scanAssets problems", () => {
  it("names both files of a duplicate key", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/panel.webp": webpVp8Bytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      'key "ui.panel" comes from two files: features/ui/assets/panel.png and features/ui/assets/panel.webp.'
    );
  });

  it("names both bundles that claim one file", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { "board.a": { tier: "lazy", files: ["**/*.png"] },' +
        ' "board.b": { tier: "lazy", files: ["chains/*.png"] } } };\n',
      "features/board/assets/chains/link.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      'file "features/board/assets/chains/link.png" is claimed by the bundles "board.a" and "board.b".'
    );
  });

  it("refuses a bundle name that is not the feature name", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { extra: { tier: "lazy" } } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      'the feature "board" declares the bundle "extra", which is neither "board" nor a name starting with "board.".'
    );
  });

  it("refuses an unknown tier", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { board: { tier: "screen" } } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow('the bundle "board" has the unknown tier "screen".');
  });

  it("refuses a bundle that is not an object", async () => {
    const root = await tree({
      "features/board/assets.ts": 'export default { kind: "bundles", map: { board: "scene" } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      'the bundle "board" has the unknown tier "undefined".'
    );
  });

  it("names an assets.ts that cannot be imported", async () => {
    const root = await tree({
      "features/board/assets.ts": "export default {\n",
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      /the description "features\/board\/assets\.ts" could not be read/
    );
  });

  it("refuses a nine border that does not fit in the image", async () => {
    const root = await tree({ "features/ui/assets/panel{nine=48}.png": pngBytes(64, 64) });

    await expect(scan(root)).rejects.toThrow(
      'the nine-slice 48 of "features/ui/assets/panel{nine=48}.png" must be smaller than half of 64×64.'
    );
  });

  it("refuses four nine sides that leave no centre", async () => {
    // The left side alone fits in half of 64, but 10 + 60 is not below 64.
    const root = await tree({ "features/ui/assets/sign{nine=10,4,60,4}.png": pngBytes(64, 32) });

    await expect(scan(root)).rejects.toThrow(
      'the nine-slice 10,4,60,4 of "features/ui/assets/sign{nine=10,4,60,4}.png" must leave a ' +
        "centre inside 64×32."
    );
  });

  it("carries the problem of a broken file name", async () => {
    const root = await tree({ "features/ui/assets/panel.v2.png": pngBytes(16, 16) });

    await expect(scan(root)).rejects.toThrow(/"\." in "panel\.v2"/);
  });

  it("carries the problem of a file that is not really an image", async () => {
    const root = await tree({ "features/ui/assets/panel.png": "not a png at all, just text" });

    await expect(scan(root)).rejects.toThrow(/is not a PNG or a WebP file/);
  });

  it("lists every problem in one error", async () => {
    const root = await tree({
      "features/ui/assets/panel.v2.png": pngBytes(16, 16),
      "features/ui/assets/logo.png": "text"
    });

    await expect(scan(root)).rejects.toThrow("[game] assets: the scan found 2 problems.");
    await expect(scan(root)).rejects.toThrow('"." in "panel.v2"');
    await expect(scan(root)).rejects.toThrow("is not a PNG or a WebP file");
    await expect(scan(root)).rejects.toThrow('Fix them and run "bun run assets:keys" again.');
  });

  it("counts a single problem in the singular", async () => {
    const root = await tree({ "features/ui/assets/logo.png": "text" });

    await expect(scan(root)).rejects.toThrow("the scan found 1 problem.");
  });
});
