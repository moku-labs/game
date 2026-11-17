import { describe, expect, it } from "vitest";
import { checkPacked } from "../../scan/pack/pack";
import type { AtlasFrame, Manifest, ManifestFile } from "../../types";

/** A loose texture of the scan. */
function scanned(key: string, width = 32, height = 16): ManifestFile {
  return { key, path: `features/ui/assets/${key.slice(3)}.png`, width, height, mb: 0.002 };
}

/** The scan of the examples: two textures and a sound. */
const source: Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "core",
      mb: 0.006,
      files: [
        scanned("ui.a"),
        scanned("ui.b"),
        {
          key: "ui.click",
          path: "features/ui/assets/click.mp3",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.002
        }
      ]
    }
  }
};

/** A packed texture on the page "ui/main-0". */
function packed(key: string, x: number, width = 32, height = 16): ManifestFile {
  return { key, width, height, mb: 0, atlas: { page: "ui/main-0", x, y: 2, width, height } };
}

/** Builds a packed manifest with the files given and one 72×20 page. */
function packOf(files: readonly ManifestFile[]): Manifest {
  return {
    version: 2,
    bundles: {
      ui: {
        feature: "ui",
        tier: "core",
        mb: 0.008,
        pages: [
          { id: "ui/main-0", path: "ui/main-0-0123456789.webp", width: 72, height: 20, mb: 0.005 }
        ],
        files
      }
    }
  };
}

const click: ManifestFile = {
  key: "ui.click",
  path: "ui/ui.click-0123456789.mp3",
  kind: "audio",
  width: 0,
  height: 0,
  mb: 0.002
};

describe("checkPacked", () => {
  it("finds nothing wrong with a right pack", () => {
    expect(checkPacked(source, packOf([packed("ui.a", 2), packed("ui.b", 36), click]))).toEqual([]);
  });

  it("names a key that did not land, one that landed twice and one the scan never had", () => {
    expect(
      checkPacked(
        source,
        packOf([packed("ui.a", 2), packed("ui.a", 36), packed("ui.zz", 2), click])
      )
    ).toEqual([
      'the frame of "ui.zz" is 32×16, its source 0×0.',
      'the key "ui.a" landed 2 times, not once.',
      'the key "ui.b" landed 0 times, not once.',
      'the key "ui.zz" is in the pack but not in the scan.'
    ]);
  });

  it("names a texture with both a path and a frame, and one with neither", () => {
    const both = { ...packed("ui.a", 2), path: "ui/ui.a-0123456789.webp" };
    const neither: ManifestFile = { key: "ui.b", width: 32, height: 16, mb: 0 };

    expect(checkPacked(source, packOf([both, neither, click]))).toEqual([
      'the texture "ui.a" must have either a path or an atlas frame.',
      'the texture "ui.b" must have either a path or an atlas frame.'
    ]);
  });

  it("names a mipmapped texture that lies on a page", () => {
    const mipmapped: ManifestFile = { ...packed("ui.a", 2), mips: true };

    expect(checkPacked(source, packOf([mipmapped, packed("ui.b", 36), click]))).toEqual([
      'the texture "ui.a" has mipmaps, so it must stay loose, but lies on page "ui/main-0".'
    ]);
  });

  it("names a frame on a page its bundle does not list, outside its page or of another size", () => {
    const elsewhere = {
      ...packed("ui.a", 2),
      atlas: { page: "board/main-0", x: 2, y: 2, width: 32, height: 16 }
    };
    const outside = packed("ui.b", 60);
    const resized = packed("ui.b", 36, 30, 16);

    expect(checkPacked(source, packOf([elsewhere, outside, click]))).toEqual([
      'the texture "ui.a" names page "board/main-0", which bundle "ui" does not list.',
      'the frame of "ui.b" lies outside page "ui/main-0" (72×20).'
    ]);
    expect(checkPacked(source, packOf([packed("ui.a", 2), resized, click]))).toEqual([
      'the frame of "ui.b" is 30×16, its source 32×16.'
    ]);
  });
});

/** A trimmed texture on the page: a 20×10 cut of a 32×16 original that started at (6, 3). */
function trimmed(key: string, x: number, trim: Partial<AtlasFrame> = {}): ManifestFile {
  const atlas: AtlasFrame = {
    page: "ui/main-0",
    x,
    y: 2,
    width: 20,
    height: 10,
    offsetX: 6,
    offsetY: 3,
    origWidth: 32,
    origHeight: 16,
    ...trim
  };

  return { key, width: 32, height: 16, mb: 0, atlas };
}

describe("checkPacked of a trimmed frame", () => {
  it("accepts a trimmed frame whose original is the size of its source and holds the cut", () => {
    expect(checkPacked(source, packOf([trimmed("ui.a", 2), packed("ui.b", 36), click]))).toEqual(
      []
    );
  });

  it("names a trimmed frame whose original size differs from its source", () => {
    // Bug caught: comparing the cut's size to the source passes a trimmed frame as a resized one,
    // and comparing nothing passes a texture repacked from another image.
    const wrong = trimmed("ui.a", 2, { origWidth: 30 });

    expect(checkPacked(source, packOf([wrong, packed("ui.b", 36), click]))).toEqual([
      'the frame of "ui.a" is 30×16, its source 32×16.'
    ]);
  });

  it("names a trimmed frame that does not lie inside its original", () => {
    // Bug caught: a cut that leaves its original draws outside the sprite's size.
    const outside = trimmed("ui.a", 2, { offsetX: 14 });

    expect(checkPacked(source, packOf([outside, packed("ui.b", 36), click]))).toEqual([
      'the frame of "ui.a" lies outside its original (32×16).'
    ]);
  });

  it("names a nine-slice texture that carries trim fields", () => {
    // Bug caught: a trimmed nine-slice loses the borders that sit in the cut-off margin.
    const nine = { left: 4, top: 4, right: 4, bottom: 4 };
    const slice: ManifestFile = { ...trimmed("ui.a", 2), nine };

    expect(checkPacked(source, packOf([slice, packed("ui.b", 36), click]))).toEqual([
      'the texture "ui.a" has nine-slice borders, so it must not be trimmed.'
    ]);
  });
});
