import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseManifest } from "../../manifest";
import { runCli, type ScanUi } from "../../scan/cli";
import type { PagePart } from "../../scan/pack/encode";
import { type PackResult, packAssets } from "../../scan/pack/pack";
import { scanAssets } from "../../scan/scan";
import type { Manifest, ManifestFile } from "../../types";
import { makeTree, removeTree, stringsTools } from "./scan-fixtures";

/** How many cut pictures each composed page was given, in order. */
const spy = vi.hoisted(() => ({ parts: [] as number[] }));

vi.mock("../../scan/pack/encode", async importOriginal => {
  const original = await importOriginal<typeof import("../../scan/pack/encode")>();

  return {
    ...original,
    loadEncoder: async () => {
      const encoder = await original.loadEncoder();

      return {
        ...encoder,
        page: (width: number, height: number, parts: readonly PagePart[]) => {
          spy.parts.push(parts.length);

          return encoder.page(width, height, parts);
        }
      };
    }
  };
});

const folders: string[] = [];

/** The RGBA pixels of an opaque picture whose colours differ pixel by pixel, from a seed. */
function picture(width: number, height: number, seed: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);

  for (let at = 0; at < width * height; at += 1) {
    data.set(
      [(at * 7 + seed) % 256, (at * 13 + seed * 3) % 256, (at + seed * 5) % 256, 255],
      at * 4
    );
  }

  return data;
}

/** The pixels of `inner` set into a transparent picture, `left` and `top` px in. */
function framed(
  inner: Uint8Array,
  size: { width: number; height: number },
  margin: { left: number; top: number; right: number; bottom: number }
): { width: number; height: number; data: Uint8Array } {
  const width = size.width + margin.left + margin.right;
  const height = size.height + margin.top + margin.bottom;
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < size.height; row += 1) {
    data.set(
      inner.subarray(row * size.width * 4, (row + 1) * size.width * 4),
      ((row + margin.top) * width + margin.left) * 4
    );
  }

  return { width, height, data };
}

/** Encodes raw RGBA pixels as a PNG. */
async function png(width: number, height: number, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
  );
}

/** A temp folder that the test run deletes. */
async function temp(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "moku-pack-same-"));

  folders.push(folder);

  return folder;
}

/** Writes a game tree and packs it, with a cache folder or none. */
async function packTree(
  files: Record<string, Uint8Array>,
  cache: string | false = false
): Promise<PackResult & { out: string }> {
  const root = await makeTree(files);
  const scratch = await temp();
  const out = await temp();

  folders.push(root);

  const { manifest } = await scanAssets({
    root,
    manifest: path.join(scratch, "manifest.json"),
    keys: path.join(scratch, "assets.ts"),
    write: false
  });
  const result = await packAssets({
    root,
    manifest,
    out,
    manifestFile: path.join(out, "manifest.json"),
    cache
  });

  return { ...result, out };
}

/** The entry of a key in the bundle `ui` of a manifest. */
function entryOf(manifest: Manifest, key: string): ManifestFile {
  const file = manifest.bundles.ui?.files.find(entry => entry.key === key);

  if (file === undefined) throw new Error(`no file "${key}"`);

  return file;
}

/** The page rectangle of a key: its page and where it lies there. */
function rectOf(manifest: Manifest, key: string): unknown {
  const atlas = entryOf(manifest, key).atlas;

  return (
    atlas && { page: atlas.page, x: atlas.x, y: atlas.y, width: atlas.width, height: atlas.height }
  );
}

/** The area of every page of the bundle `ui` of a pack, in px. */
function area(result: PackResult): number {
  return (result.manifest.bundles.ui?.pages ?? []).reduce(
    (sum, page) => sum + page.width * page.height,
    0
  );
}

afterEach(async () => {
  spy.parts.length = 0;
  for (const folder of folders.splice(0)) {
    await removeTree(folder).catch(() => rm(folder, { recursive: true, force: true }));
  }
});

describe("packAssets, identical pictures of a bundle", () => {
  it("gives two keys with the same pixels one rectangle of the page, drawn once, on a smaller page", async () => {
    // Bug caught: the packer lays the same pixels out once per key, so a copy costs page area.
    const same = await png(60, 40, picture(60, 40, 1));
    const shared = await packTree({
      "features/ui/assets/a.png": same,
      "features/ui/assets/b.png": same,
      "features/ui/assets/c.png": await png(20, 20, picture(20, 20, 9))
    });
    const sharedParts = [...spy.parts];

    spy.parts.length = 0;

    const apart = await packTree({
      "features/ui/assets/a.png": same,
      "features/ui/assets/b.png": await png(60, 40, picture(60, 40, 2)),
      "features/ui/assets/c.png": await png(20, 20, picture(20, 20, 9))
    });

    expect(rectOf(shared.manifest, "ui.b")).toEqual(rectOf(shared.manifest, "ui.a"));
    expect(rectOf(shared.manifest, "ui.c")).not.toEqual(rectOf(shared.manifest, "ui.a"));
    expect(rectOf(apart.manifest, "ui.b")).not.toEqual(rectOf(apart.manifest, "ui.a"));
    expect(sharedParts).toEqual([2]);
    expect(spy.parts).toEqual([3]);
    expect(area(shared)).toBeLessThan(area(apart));
    expect(shared.manifest.bundles.ui?.mb).toBeLessThan(apart.manifest.bundles.ui?.mb ?? 0);
  });

  it("keeps two frames for pictures that differ in one pixel", async () => {
    // Bug caught: a compare by size alone, or by a prefix of the pixels, merges different pictures.
    const one = picture(60, 40, 1);
    const other = new Uint8Array(one);

    other[other.length - 2] = (other.at(-2) ?? 0) ^ 1;

    const { manifest } = await packTree({
      "features/ui/assets/a.png": await png(60, 40, one),
      "features/ui/assets/b.png": await png(60, 40, other)
    });

    expect(rectOf(manifest, "ui.b")).not.toEqual(rectOf(manifest, "ui.a"));
    expect(spy.parts).toEqual([2]);
  });

  it("shares the rectangle of two files that differ only in their transparent margin, each with its own trim", async () => {
    // Bug caught: a shared frame that copies the first key's trim draws the second one shifted.
    const inner = picture(30, 20, 4);
    const wide = framed(
      inner,
      { width: 30, height: 20 },
      { left: 12, top: 5, right: 3, bottom: 9 }
    );
    const tight = framed(
      inner,
      { width: 30, height: 20 },
      { left: 4, top: 14, right: 20, bottom: 2 }
    );
    const { manifest } = await packTree({
      "features/ui/assets/a.png": await png(wide.width, wide.height, wide.data),
      "features/ui/assets/b.png": await png(tight.width, tight.height, tight.data)
    });

    expect(rectOf(manifest, "ui.b")).toEqual(rectOf(manifest, "ui.a"));
    // The cut keeps a margin of one transparent pixel, so the offset is the margin less one.
    expect(entryOf(manifest, "ui.a").atlas).toMatchObject({
      offsetX: 11,
      offsetY: 4,
      origWidth: wide.width,
      origHeight: wide.height
    });
    expect(entryOf(manifest, "ui.b").atlas).toMatchObject({
      offsetX: 3,
      offsetY: 13,
      origWidth: tight.width,
      origHeight: tight.height
    });
  });

  it("shares the rectangle of a trimmed file and of a file that is already its cut, whichever key comes first", async () => {
    // Bug caught: a repeat without a trim takes the trim of the cut it repeats, or loses its own.
    const inner = picture(30, 20, 4);
    const wide = framed(
      inner,
      { width: 30, height: 20 },
      { left: 12, top: 5, right: 3, bottom: 9 }
    );
    const cut = framed(inner, { width: 30, height: 20 }, { left: 1, top: 1, right: 1, bottom: 1 });
    const trimmed = await png(wide.width, wide.height, wide.data);
    const whole = await png(cut.width, cut.height, cut.data);
    const wholeFirst = await packTree({
      "features/ui/assets/a.png": whole,
      "features/ui/assets/b.png": trimmed
    });
    const trimmedFirst = await packTree({
      "features/ui/assets/a.png": trimmed,
      "features/ui/assets/b.png": whole
    });

    for (const [manifest, wholeKey, trimmedKey] of [
      [wholeFirst.manifest, "ui.a", "ui.b"],
      [trimmedFirst.manifest, "ui.b", "ui.a"]
    ] as const) {
      expect(rectOf(manifest, wholeKey)).toEqual(rectOf(manifest, trimmedKey));
      expect(entryOf(manifest, wholeKey).atlas).not.toHaveProperty("offsetX");
      expect(entryOf(manifest, wholeKey).atlas).not.toHaveProperty("origWidth");
      expect(entryOf(manifest, trimmedKey).atlas).toMatchObject({
        offsetX: 11,
        offsetY: 4,
        origWidth: wide.width,
        origHeight: wide.height
      });
    }
  });

  it("lets a nine-slice and a plain texture with the same pixels share a frame, and the nine-slice keeps its borders", async () => {
    // Bug caught: the shared frame is written from the first key's entry and the borders are lost.
    const same = await png(48, 48, picture(48, 48, 6));
    const { manifest } = await packTree({
      "features/ui/assets/panel{nine=8}.png": same,
      "features/ui/assets/plain.png": same
    });

    expect(rectOf(manifest, "ui.plain")).toEqual(rectOf(manifest, "ui.panel"));
    expect(entryOf(manifest, "ui.panel").nine).toEqual({ left: 8, top: 8, right: 8, bottom: 8 });
    expect(entryOf(manifest, "ui.plain").nine).toBeUndefined();
  });

  it("writes a manifest the runtime reads, with both keys on the same rectangle", async () => {
    // Bug caught: the runtime's parser refuses two frames on one rectangle, and the game does not start.
    const same = await png(60, 40, picture(60, 40, 1));
    const { out } = await packTree({
      "features/ui/assets/a.png": same,
      "features/ui/assets/b.png": same
    });
    const parsed = parseManifest(
      JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"))
    );
    const files = parsed.bundles.ui?.files ?? [];
    const a = files.find(entry => entry.key === "ui.a")?.atlas;
    const b = files.find(entry => entry.key === "ui.b")?.atlas;

    expect(a).toBeDefined();
    expect(b).toEqual(a);
  });

  it("writes the same bytes cold and from the cache", async () => {
    // Bug caught: the frames of the repeats are added after the cache was written, so a cached run loses them.
    const same = await png(60, 40, picture(60, 40, 1));
    const files = {
      "features/ui/assets/a.png": same,
      "features/ui/assets/b.png": same,
      "features/ui/assets/c.png": await png(20, 20, picture(20, 20, 9))
    };
    const cache = await temp();
    const cold = await packTree(files, cache);
    const warm = await packTree(files, cache);

    expect(warm.cacheHits).toBe(1);
    expect(warm.manifest).toEqual(cold.manifest);
    expect(rectOf(warm.manifest, "ui.b")).toEqual(rectOf(warm.manifest, "ui.a"));
  });
});

describe("packAssets, the same file under two keys", () => {
  it("names the keys and the bundles of a file kept in two bundles, and of one kept three times", async () => {
    // Bug caught: a copy of a picture in a second feature folder is packed again and nobody is told.
    const same = await png(64, 32, picture(64, 32, 1));
    const third = await png(16, 16, picture(16, 16, 2));
    const { notes } = await packTree({
      "features/ui/assets/close.png": same,
      "features/shop/assets/close.png": same,
      "features/ui/assets/dot.png": third,
      "features/ui/assets/dot-copy.png": third,
      "features/board/assets/dot.png": third,
      "features/board/assets/own.png": await png(16, 16, picture(16, 16, 3))
    });

    expect(notes).toEqual([
      'the same file (16×16, 0.001 MB) is kept under 3 keys: "board.dot", "ui.dot", "ui.dot-copy", in bundles "board", "ui".',
      'the same file (64×32, 0.008 MB) is kept under 2 keys: "shop.close", "ui.close", in bundles "shop", "ui".'
    ]);
  });

  it("names a loose file kept twice too: the bytes are compared, not the frames", async () => {
    // Bug caught: the compare runs on atlas members only, and the largest copies go unnamed.
    const big = await png(1100, 8, picture(1100, 8, 5));
    const { notes } = await packTree({
      "features/ui/assets/sky.png": big,
      "features/shop/assets/sky.png": big
    });

    expect(notes).toEqual([
      'the same file (1100×8, 0.034 MB) is kept under 2 keys: "shop.sky", "ui.sky", in bundles "shop", "ui".'
    ]);
  });

  it("has no note when every file differs", async () => {
    const { notes } = await packTree({
      "features/ui/assets/a.png": await png(16, 16, picture(16, 16, 1)),
      "features/shop/assets/a.png": await png(16, 16, picture(16, 16, 2))
    });

    expect(notes).toEqual([]);
  });

  it("prints the notes after the summary line of the pack command, and still exits 0", async () => {
    // Bug caught: the notes are computed and never shown, so the build stays silent.
    const same = await png(64, 32, picture(64, 32, 1));
    const root = await makeTree({
      "features/ui/assets/close.png": same,
      "features/shop/assets/close.png": same
    });
    const out = path.join(await temp(), "assets");
    const lines: string[] = [];
    const ui: ScanUi = {
      info: line => lines.push(`info ${line}`),
      warn: line => lines.push(`warn ${line}`),
      error: line => lines.push(`error ${line}`)
    };

    folders.push(root);

    expect(await runCli(["--root", root, "--pack", out, "--no-cache"], stringsTools(), ui)).toBe(0);

    const summary = lines.findIndex(line => line.startsWith("info wrote "));

    expect(summary).toBeGreaterThan(-1);
    expect(lines[summary + 1]).toBe(
      'warn the same file (64×32, 0.008 MB) is kept under 2 keys: "shop.close", "ui.close", in bundles "shop", "ui".'
    );
  });
});
