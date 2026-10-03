import { describe, expect, it } from "vitest";
import { checkPacked } from "../../scan/pack/pack";
import type { Manifest, ManifestFile } from "../../types";

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
