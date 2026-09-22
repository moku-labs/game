import { afterEach, describe, expect, it } from "vitest";
import { emitKeys, emitManifest } from "../../scan/emit";
import { pagesOfFont } from "../../scan/fonts";
import { type ScanResult, scanAssets } from "../../scan/scan";
import {
  audioBytes,
  bmfontJson,
  bmfontText,
  bmfontXml,
  makeTree,
  pngBytes,
  removeTree
} from "./scan-fixtures";

const roots: string[] = [];

async function tree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await makeTree(files);

  roots.push(root);

  return root;
}

async function scan(root: string): Promise<ScanResult> {
  return await scanAssets({
    root,
    manifest: `${root}/out/manifest.json`,
    keys: `${root}/out/generated/assets.ts`,
    write: false
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("fonts", () => {
  it("makes one asset out of a .fnt and its two pages", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontText("body_0.png", "body_1.png"),
      "features/ui/assets/body_0.png": pngBytes(128, 128),
      "features/ui/assets/body_1.png": pngBytes(128, 128)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files).toEqual([
      {
        key: "ui.body",
        path: "features/ui/assets/body.fnt",
        kind: "font",
        width: 0,
        height: 0,
        mb: 0.126,
        pages: [
          { path: "features/ui/assets/body_0.png", width: 128, height: 128, mb: 0.063 },
          { path: "features/ui/assets/body_1.png", width: 128, height: 128, mb: 0.063 }
        ]
      }
    ]);
    expect(manifest.bundles.ui?.mb).toBe(0.126);
  });

  it("reads the pages of a BMFont XML file", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontXml("body_0.png"),
      "features/ui/assets/body_0.png": pngBytes(64, 64)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files[0]?.pages).toEqual([
      { path: "features/ui/assets/body_0.png", width: 64, height: 64, mb: 0.016 }
    ]);
  });

  it("reads the pages of a BMFont JSON file", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontJson("body_0.png"),
      "features/ui/assets/body_0.png": pngBytes(64, 64)
    });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files[0]?.pages?.[0]?.path).toBe("features/ui/assets/body_0.png");
  });

  it("keeps a page in a subfolder out of the asset keys", async () => {
    const root = await tree({
      "features/ui/assets/fonts/body.fnt": bmfontText("body_0.png"),
      "features/ui/assets/fonts/body_0.png": pngBytes(64, 64),
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    const { manifest, notes } = await scan(root);

    expect(manifest.bundles.ui?.files.map(file => file.key)).toEqual(["ui.fonts.body", "ui.panel"]);
    expect(manifest.bundles.ui?.files[0]?.pages).toEqual([
      { path: "features/ui/assets/fonts/body_0.png", width: 64, height: 64, mb: 0.016 }
    ]);
    expect(notes).toEqual([]);
  });

  it("names a page the folder does not have", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontText("body_0.png"),
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    await expect(scan(root)).rejects.toThrow(
      'the font "features/ui/assets/body.fnt" names the page "body_0.png", which is not next to it.'
    );
  });

  it("refuses a .fnt that declares no page", async () => {
    const root = await tree({ "features/ui/assets/body.fnt": 'info face="body" size=32\n' });

    await expect(scan(root)).rejects.toThrow(
      'the font "features/ui/assets/body.fnt" declares no page.'
    );
  });
});

describe("pagesOfFont", () => {
  it("reads a JSON font whose pages are objects", () => {
    const source = JSON.stringify({ pages: [{ id: 0, file: "body_0.png" }], chars: [] });

    expect(pagesOfFont(source, "features/ui/assets/body.fnt")).toEqual(["body_0.png"]);
  });

  it("refuses JSON it cannot read", () => {
    expect(() => pagesOfFont("{ pages: ", "features/ui/assets/body.fnt")).toThrow(
      '[game] assets: the font "features/ui/assets/body.fnt" is not readable BMFont JSON.'
    );
  });

  it("refuses a JSON font without a pages list", () => {
    expect(() => pagesOfFont('{ "chars": [] }', "features/ui/assets/body.fnt")).toThrow(
      "declares no page."
    );
  });
});

describe("audio", () => {
  it("takes an .mp3 as an audio asset sized by its bytes", async () => {
    const root = await tree({ "features/ui/assets/click.mp3": audioBytes(8192) });

    const { manifest } = await scan(root);

    expect(manifest.bundles.ui?.files).toEqual([
      {
        key: "ui.click",
        path: "features/ui/assets/click.mp3",
        kind: "audio",
        width: 0,
        height: 0,
        mb: 0.008
      }
    ]);
  });

  it("ignores .wav, .ogg and .ttf with a note", async () => {
    const root = await tree({
      "features/ui/assets/click.mp3": audioBytes(1024),
      "features/ui/assets/click.wav": audioBytes(1024),
      "features/ui/assets/theme.ogg": audioBytes(1024),
      "features/ui/assets/body.ttf": audioBytes(1024)
    });

    const { manifest, notes } = await scan(root);

    expect(notes).toEqual([
      'ignored "features/ui/assets/body.ttf": a font is a .fnt file with its .png pages.',
      'ignored "features/ui/assets/click.wav": audio is .mp3 only.',
      'ignored "features/ui/assets/theme.ogg": audio is .mp3 only.'
    ]);
    expect(manifest.bundles.ui?.files.map(file => file.key)).toEqual(["ui.click"]);
  });

  it("says which extensions it reads when it leaves another file out", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/notes.md": "how the panel was drawn"
    });

    const { notes } = await scan(root);

    expect(notes).toEqual([
      'ignored "features/ui/assets/notes.md": the scanner reads .png, .webp, .fnt and .mp3 only.'
    ]);
  });
});

describe("generated keys", () => {
  it("writes AssetKey over every kind and the two narrow unions next to it", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontText("body_0.png"),
      "features/ui/assets/body_0.png": pngBytes(64, 64),
      "features/ui/assets/click.mp3": audioBytes(1024),
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    const { manifest, keysSource } = await scan(root);

    expect(keysSource).toContain(
      'export type AssetKey =\n  | "ui.body"\n  | "ui.click"\n  | "ui.panel";'
    );
    expect(keysSource).toContain('export type FontKey =\n  | "ui.body";');
    expect(keysSource).toContain('export type AudioKey =\n  | "ui.click";');
    expect(emitKeys(manifest)).toBe(keysSource);
  });

  it("writes never for a game without fonts or audio", async () => {
    const root = await tree({ "features/ui/assets/panel.png": pngBytes(16, 16) });

    const { keysSource } = await scan(root);

    expect(keysSource).toContain("export type FontKey = never;");
    expect(keysSource).toContain("export type AudioKey = never;");
  });
});

describe("the manifest file", () => {
  it("writes the kind and the pages, and nothing extra for a texture", async () => {
    const root = await tree({
      "features/ui/assets/body.fnt": bmfontText("body_0.png"),
      "features/ui/assets/body_0.png": pngBytes(64, 64),
      "features/ui/assets/click.mp3": audioBytes(1024),
      "features/ui/assets/panel.png": pngBytes(16, 16)
    });

    const { manifest } = await scan(root);
    const text = emitManifest(manifest);

    expect(text).toContain(`        {
          "key": "ui.body",
          "path": "features/ui/assets/body.fnt",
          "kind": "font",
          "mb": 0.016,
          "pages": [
            {
              "path": "features/ui/assets/body_0.png",
              "width": 64,
              "height": 64,
              "mb": 0.016
            }
          ]
        },`);
    expect(text).toContain(`        {
          "key": "ui.click",
          "path": "features/ui/assets/click.mp3",
          "kind": "audio",
          "mb": 0.001
        },`);
    expect(text).toContain(`        {
          "key": "ui.panel",
          "path": "features/ui/assets/panel.png",
          "width": 16,
          "height": 16,
          "mb": 0.001
        }`);
  });
});
