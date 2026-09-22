import { afterEach, describe, expect, it } from "vitest";
import { scanFeatures } from "../../scan/scan";
import { makeTree, pngBytes, removeTree, webpVp8Bytes } from "./scan-fixtures";

const roots: string[] = [];

async function tree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await makeTree(files);

  roots.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("scanFeatures", () => {
  it("makes one feature-tier bundle out of a feature without assets.ts", async () => {
    const root = await tree({
      "features/board/assets/item-a-1.png": pngBytes(64, 64),
      "features/board/assets/cell.png": pngBytes(64, 64)
    });

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

    expect(manifest.bundles.ui?.files[0]).toEqual({
      key: "ui.panel",
      path: "features/ui/assets/panel{nine=48}.png",
      width: 256,
      height: 128,
      mb: 0.125,
      nine: { left: 48, top: 48, right: 48, bottom: 48 }
    });
  });

  it("reads the features folder the options name", async () => {
    const root = await tree({ "parts/ui/assets/panel.png": pngBytes(16, 16) });

    const { manifest } = await scanFeatures(root, { features: "parts" });

    expect(manifest.bundles.ui?.files[0]?.path).toBe("parts/ui/assets/panel.png");
  });

  it("ignores a file that is neither PNG nor WebP and says so in a note", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/notes.md": "how the panel was drawn"
    });

    const { manifest, notes } = await scanFeatures(root);

    expect(notes).toEqual([
      'ignored "features/ui/assets/notes.md": the scanner reads .png and .webp only.'
    ]);
    expect(manifest.bundles.ui?.files).toHaveLength(1);
  });

  it("is empty when the features folder is missing", async () => {
    const root = await tree({ "readme.md": "no features yet" });

    const { manifest, notes } = await scanFeatures(root);

    expect(manifest).toEqual({ version: 1, bundles: {} });
    expect(notes).toEqual([]);
  });

  it("skips a feature without an assets folder", async () => {
    const root = await tree({
      "features/rules/index.ts": "export const rules = 1;\n",
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

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

    const { manifest } = await scanFeatures(root);

    expect(Object.keys(manifest.bundles)).toEqual(["board", "ui"]);
    expect(manifest.bundles.ui?.files.map(file => file.key)).toEqual(["ui.a", "ui.z"]);
  });
});

describe("scanFeatures problems", () => {
  it("names both files of a duplicate key", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/panel.webp": webpVp8Bytes(16, 16)
    });

    await expect(scanFeatures(root)).rejects.toThrow(
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

    await expect(scanFeatures(root)).rejects.toThrow(
      'file "features/board/assets/chains/link.png" is claimed by the bundles "board.a" and "board.b".'
    );
  });

  it("refuses a bundle name that is not the feature name", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { extra: { tier: "lazy" } } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scanFeatures(root)).rejects.toThrow(
      'the feature "board" declares the bundle "extra", which is neither "board" nor a name starting with "board.".'
    );
  });

  it("refuses an unknown tier", async () => {
    const root = await tree({
      "features/board/assets.ts":
        'export default { kind: "bundles", map: { board: { tier: "screen" } } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scanFeatures(root)).rejects.toThrow(
      'the bundle "board" has the unknown tier "screen".'
    );
  });

  it("refuses a bundle that is not an object", async () => {
    const root = await tree({
      "features/board/assets.ts": 'export default { kind: "bundles", map: { board: "scene" } };\n',
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scanFeatures(root)).rejects.toThrow(
      'the bundle "board" has the unknown tier "undefined".'
    );
  });

  it("names an assets.ts that cannot be imported", async () => {
    const root = await tree({
      "features/board/assets.ts": "export default {\n",
      "features/board/assets/cell.png": pngBytes(16, 16)
    });

    await expect(scanFeatures(root)).rejects.toThrow(
      /the description "features\/board\/assets\.ts" could not be read/
    );
  });

  it("refuses a nine border that does not fit in the image", async () => {
    const root = await tree({ "features/ui/assets/panel{nine=48}.png": pngBytes(64, 64) });

    await expect(scanFeatures(root)).rejects.toThrow(
      'the nine-slice 48 of "features/ui/assets/panel{nine=48}.png" must be smaller than half of 64×64.'
    );
  });

  it("carries the problem of a broken file name", async () => {
    const root = await tree({ "features/ui/assets/panel.v2.png": pngBytes(16, 16) });

    await expect(scanFeatures(root)).rejects.toThrow(/"\." in "panel\.v2"/);
  });

  it("carries the problem of a file that is not really an image", async () => {
    const root = await tree({ "features/ui/assets/panel.png": "not a png at all, just text" });

    await expect(scanFeatures(root)).rejects.toThrow(/is not a PNG or a WebP file/);
  });

  it("lists every problem in one error", async () => {
    const root = await tree({
      "features/ui/assets/panel.v2.png": pngBytes(16, 16),
      "features/ui/assets/logo.png": "text"
    });

    await expect(scanFeatures(root)).rejects.toThrow("[game] assets: the scan found 2 problems.");
    await expect(scanFeatures(root)).rejects.toThrow('"." in "panel.v2"');
    await expect(scanFeatures(root)).rejects.toThrow("is not a PNG or a WebP file");
    await expect(scanFeatures(root)).rejects.toThrow(
      'Fix them and run "bun run assets:keys" again.'
    );
  });

  it("counts a single problem in the singular", async () => {
    const root = await tree({ "features/ui/assets/logo.png": "text" });

    await expect(scanFeatures(root)).rejects.toThrow("the scan found 1 problem.");
  });
});
