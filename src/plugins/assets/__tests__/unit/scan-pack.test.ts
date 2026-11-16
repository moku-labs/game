import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type ScanUi } from "../../scan/cli";
import { textureMb } from "../../scan/image-size";
import { composePage, type PagePart } from "../../scan/pack/encode";
import { LOOSE_SIDE } from "../../scan/pack/groups";
import { PAGE_SIZES, roomOf } from "../../scan/pack/layout";
import { type PackResult, packAssets } from "../../scan/pack/pack";
import { scanAssets } from "../../scan/scan";
import type { Manifest, ManifestBundle, ManifestFile } from "../../types";
import { audioBytes, bmfontText, makeTree, removeTree, stringsTools } from "./scan-fixtures";

/** A page the packer composed: its size and the cut pixels it was given. */
type Composed = { width: number; height: number; parts: readonly PagePart[] };

/** Every page `encoder.page` was asked to compose, in order: what the trim tests read. */
const spy = vi.hoisted(() => ({ composed: [] as Composed[] }));

vi.mock("../../scan/pack/encode", async importOriginal => {
  const original = await importOriginal<typeof import("../../scan/pack/encode")>();

  return {
    ...original,
    loadEncoder: async () => {
      const encoder = await original.loadEncoder();

      return {
        ...encoder,
        page: (width: number, height: number, parts: readonly PagePart[]) => {
          spy.composed.push({ width, height, parts });

          return encoder.page(width, height, parts);
        }
      };
    }
  };
});

const folders: string[] = [];

/** A colour of a drawn test image. */
type Colour = { r: number; g: number; b: number };

const RED: Colour = { r: 220, g: 30, b: 30 };
const GREEN: Colour = { r: 30, g: 200, b: 60 };
const BLUE: Colour = { r: 20, g: 40, b: 230 };
const YELLOW: Colour = { r: 240, g: 220, b: 20 };
const MAGENTA: Colour = { r: 200, g: 20, b: 200 };
const GREY: Colour = { r: 120, g: 120, b: 120 };

/** Draws an opaque PNG of one colour. */
async function png(width: number, height: number, colour: Colour): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 4, background: { ...colour, alpha: 1 } }
  });

  return new Uint8Array(await image.png().toBuffer());
}

/** Draws a lossless WebP of one colour. */
async function webp(width: number, height: number, colour: Colour): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 4, background: { ...colour, alpha: 1 } }
  });

  return new Uint8Array(await image.webp({ lossless: true }).toBuffer());
}

/** A temp folder that the test run deletes. */
async function temp(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "moku-pack-"));

  folders.push(folder);

  return folder;
}

/** The width of the textures that stay loose by size: one pixel above the side `groupOf` packs. */
const WIDE = LOOSE_SIDE + 1;

/**
 * The game tree of these tests: `ui` has two fx textures, three small textures (one nine-slice),
 * a loose WebP and a loose PNG by size, a font with one page and a sound; `board` has a single
 * texture, a group of one.
 */
async function gameTree(): Promise<string> {
  const root = await makeTree({
    "features/ui/assets/fx-spark.png": await png(16, 16, RED),
    "features/ui/assets/fx-star.png": await png(12, 12, GREEN),
    "features/ui/assets/icon-a.png": await png(20, 20, BLUE),
    "features/ui/assets/icon-b.png": await png(24, 10, YELLOW),
    "features/ui/assets/panel{nine=4}.png": await png(32, 16, MAGENTA),
    "features/ui/assets/bg.webp": await webp(WIDE, 20, GREY),
    "features/ui/assets/big.png": await png(WIDE, 8, GREY),
    "features/ui/assets/body.fnt": bmfontText("body_0.png"),
    "features/ui/assets/body_0.png": await png(16, 16, GREY),
    "features/ui/assets/click.mp3": audioBytes(2048),
    "features/board/assets/cell.png": await png(40, 40, GREEN)
  });

  folders.push(root);

  return root;
}

/** Scans a tree without writing anything, for the v1 manifest the packer reads. */
async function scanOf(root: string, layers?: Readonly<Record<string, string>>): Promise<Manifest> {
  const scratch = await temp();
  const { manifest } = await scanAssets({
    root,
    manifest: path.join(scratch, "manifest.json"),
    keys: path.join(scratch, "assets.ts"),
    write: false,
    ...(layers === undefined ? {} : { layers })
  });

  return manifest;
}

/**
 * A game tree on the layered layout: `board` is a feature with one texture, `shared/` is a layer
 * with two small textures (one page) and a loose WebP by size.
 */
async function layeredTree(): Promise<string> {
  const root = await makeTree({
    "features/board/assets/cell.png": await png(40, 40, GREEN),
    "shared/assets/icon-a.png": await png(20, 20, BLUE),
    "shared/assets/icon-b.png": await png(24, 10, YELLOW),
    "shared/assets/bg.webp": await webp(WIDE, 20, GREY)
  });

  folders.push(root);

  return root;
}

/**
 * The RGBA pixels of a `width × height` image that is transparent except for an inset rectangle,
 * drawn in colours that differ pixel by pixel, so a wrong offset or a wrong row shows.
 */
function marginPixels(width: number, height: number, margin: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);

  for (let row = margin; row < height - margin; row += 1) {
    for (let column = margin; column < width - margin; column += 1) {
      data.set(
        [(column * 7) % 256, (row * 13) % 256, (column + row * 3) % 256, 255],
        (row * width + column) * 4
      );
    }
  }

  return data;
}

/** Encodes raw RGBA pixels as a PNG. */
async function pngOfPixels(width: number, height: number, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer()
  );
}

/** Packs a tree into a folder, with a cache folder or none. */
async function pack(
  root: string,
  out: string,
  cache: string | false
): Promise<PackResult & { source: Manifest }> {
  const source = await scanOf(root);
  const result = await packAssets({
    root,
    manifest: source,
    out,
    manifestFile: path.join(out, "manifest.json"),
    cache
  });

  return { ...result, source };
}

/** Every file of a folder, by its POSIX path inside it, with its bytes. */
async function snapshot(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(folder, absolute).split(path.sep).join("/");

    files.set(relative, Buffer.from(await readFile(absolute)).toString("base64"));
  }

  return files;
}

/** The bundle of a manifest, or a failure that names it. */
function bundleOf(manifest: Manifest, name: string): ManifestBundle {
  const bundle = manifest.bundles[name];

  if (bundle === undefined) throw new Error(`no bundle "${name}"`);

  return bundle;
}

/** The file of a bundle, or a failure that names it. */
function fileOf(bundle: ManifestBundle, key: string): ManifestFile {
  const file = bundle.files.find(entry => entry.key === key);

  if (file === undefined) throw new Error(`no file "${key}"`);

  return file;
}

/** Every key of a manifest, bundle by bundle. */
function keysOf(manifest: Manifest): string[] {
  return Object.values(manifest.bundles).flatMap(bundle => bundle.files.map(file => file.key));
}

/** The path of one page of the bundle `ui` of a pack. */
function pagePathOf(result: PackResult, id: string): string | undefined {
  return bundleOf(result.manifest, "ui").pages?.find(page => page.id === id)?.path;
}

/** A recorder of the CLI lines. */
function recorder(): ScanUi & { lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    info: message => lines.push(`info ${message}`),
    warn: message => lines.push(`warn ${message}`),
    error: message => lines.push(`error ${message}`)
  };
}

/** The string tools of a game with no strings. */
const noStrings = stringsTools();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map(folder => removeTree(folder)));
});

describe("packAssets", () => {
  it("writes no page file past the largest page size, border, padding and edge copy counted (F188)", async () => {
    // Sixteen 510 px squares: four in a row would make a 2050 px page on a 2048 px page size.
    const files: Record<string, Uint8Array> = {};
    const square = await png(510, 510, BLUE);

    for (let index = 0; index < 16; index += 1) {
      files[`features/ui/assets/sq-${String(index).padStart(2, "0")}.png`] = square;
    }

    const root = await makeTree(files);

    folders.push(root);

    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const pages = bundleOf(manifest, "ui").pages ?? [];

    const largest = Math.max(...PAGE_SIZES);

    expect(pages.length).toBeGreaterThan(0);

    for (const page of pages) {
      const written = await sharp(path.join(out, page.path)).metadata();

      expect(written.width).toBeLessThanOrEqual(largest);
      expect(written.height).toBeLessThanOrEqual(largest);
    }
  });

  it("lands every key of the scan once, as a frame of a page of its bundle or as a loose file", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest, source, pages, loose } = await pack(root, out, false);

    expect(manifest.version).toBe(2);
    expect(keysOf(manifest)).toEqual(keysOf(source));
    expect(bundleOf(manifest, "ui").pages?.map(page => page.id)).toEqual(["ui/fx-0", "ui/main-0"]);
    expect(bundleOf(manifest, "board")).not.toHaveProperty("pages");
    expect(pages).toBe(2);
    // bg and big by their size, cell as a group of one.
    expect(loose).toBe(3);

    for (const bundle of Object.values(manifest.bundles)) {
      for (const file of bundle.files.filter(entry => entry.kind === undefined)) {
        expect(file.atlas === undefined).toBe(file.path !== undefined);

        if (file.atlas === undefined) continue;

        const atlas = file.atlas;
        const page = bundle.pages?.find(entry => entry.id === atlas.page);

        expect(page).toBeDefined();
        expect(atlas.x + atlas.width).toBeLessThanOrEqual(page?.width ?? 0);
        expect(atlas.y + atlas.height).toBeLessThanOrEqual(page?.height ?? 0);
      }
    }
  });

  it("puts the fx textures on their own page and keeps the size and the nine of a packed file", async () => {
    const root = await gameTree();
    const { manifest } = await pack(root, await temp(), false);
    const ui = bundleOf(manifest, "ui");

    expect(fileOf(ui, "ui.fx-spark").atlas?.page).toBe("ui/fx-0");
    expect(fileOf(ui, "ui.fx-star").atlas?.page).toBe("ui/fx-0");
    expect(fileOf(ui, "ui.panel")).toEqual({
      key: "ui.panel",
      width: 32,
      height: 16,
      mb: 0,
      nine: { left: 4, top: 4, right: 4, bottom: 4 },
      atlas: { page: "ui/main-0", ...fileOf(ui, "ui.panel").atlas, width: 32, height: 16 }
    });
  });

  it("writes WebP pages whose pixels inside a frame are the source's", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const ui = bundleOf(manifest, "ui");
    const page = ui.pages?.find(entry => entry.id === "ui/main-0");
    const bytes = await readFile(path.join(out, page?.path ?? ""));
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frame = fileOf(ui, "ui.icon-a").atlas;
    const centre = ((frame?.y ?? 0) + 10) * info.width + (frame?.x ?? 0) + 10;

    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect({ width: info.width, height: info.height }).toEqual({
      width: page?.width,
      height: page?.height
    });
    expect(Math.abs((data[centre * 4] ?? 0) - BLUE.r)).toBeLessThan(16);
    expect(Math.abs((data[centre * 4 + 2] ?? 0) - BLUE.b)).toBeLessThan(16);
    // The border stays transparent.
    expect(data[3]).toBe(0);
  });

  it("copies a loose WebP byte for byte and encodes a loose PNG to WebP", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const ui = bundleOf(manifest, "ui");
    const bg = fileOf(ui, "ui.bg");
    const big = fileOf(ui, "ui.big");

    expect(await readFile(path.join(out, bg.path ?? ""))).toEqual(
      await readFile(path.join(root, "features/ui/assets/bg.webp"))
    );
    expect(big.path).toMatch(/^ui\/ui\.big-[0-9a-f]{10}\.webp$/);
    const bigBytes = await readFile(path.join(out, big.path ?? ""));

    expect(bigBytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(big).toMatchObject({ width: WIDE, height: 8, mb: textureMb(WIDE, 8) });
  });

  it("rewrites the .fnt to name its hashed page, and copies the page byte for byte", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const font = fileOf(bundleOf(manifest, "ui"), "ui.body");
    const [page] = font.pages ?? [];
    const fnt = await readFile(path.join(out, font.path ?? ""), "utf8");

    expect(font.path).toMatch(/^ui\/ui\.body-[0-9a-f]{10}\.fnt$/);
    expect(page?.path).toMatch(/^ui\/ui\.body-0-[0-9a-f]{10}\.png$/);
    expect(fnt).toContain(`file="${path.posix.basename(page?.path ?? "")}"`);
    expect(fnt).not.toContain("body_0.png");
    expect(await readFile(path.join(out, page?.path ?? ""))).toEqual(
      await readFile(path.join(root, "features/ui/assets/body_0.png"))
    );
  });

  it("copies a sound byte for byte under a hashed name", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const click = fileOf(bundleOf(manifest, "ui"), "ui.click");

    expect(click).toMatchObject({ kind: "audio", mb: 0.002 });
    expect(click.path).toMatch(/^ui\/ui\.click-[0-9a-f]{10}\.mp3$/);
    expect(await readFile(path.join(out, click.path ?? ""))).toEqual(
      await readFile(path.join(root, "features/ui/assets/click.mp3"))
    );
  });

  it("copies an .m4a byte for byte under a hashed name that keeps its extension", async () => {
    const root = await makeTree({ "features/ui/assets/theme.m4a": audioBytes(4096) });

    folders.push(root);

    const out = await temp();
    const { manifest } = await pack(root, out, false);
    const theme = fileOf(bundleOf(manifest, "ui"), "ui.theme");

    expect(theme).toMatchObject({ kind: "audio", mb: 0.004 });
    expect(theme.path).toMatch(/^ui\/ui\.theme-[0-9a-f]{10}\.m4a$/);
    expect(await readFile(path.join(out, theme.path ?? ""))).toEqual(
      await readFile(path.join(root, "features/ui/assets/theme.m4a"))
    );
  });

  it("costs a bundle its pages, loose textures, font pages and sounds", async () => {
    const root = await gameTree();
    const { manifest, bytes } = await pack(root, await temp(), false);
    const ui = bundleOf(manifest, "ui");
    const parts = [
      ...(ui.pages ?? []).map(page => page.mb),
      ...ui.files.filter(file => file.atlas === undefined).map(file => file.mb)
    ];

    expect(ui.mb).toBeCloseTo(
      parts.reduce((sum, mb) => sum + mb, 0),
      3
    );
    expect(bundleOf(manifest, "board").mb).toBe(0.006);
    expect(bytes).toBeGreaterThan(2048);
  });

  it("writes the same bytes twice, the second time with every page from the cache", async () => {
    const root = await gameTree();
    const out = await temp();
    const cache = await temp();
    const first = await pack(root, out, cache);
    const before = await snapshot(out);
    const second = await pack(root, out, cache);

    expect(first.cacheHits).toBe(0);
    expect(second.cacheHits).toBe(second.pages);
    expect(await snapshot(out)).toEqual(before);
  });

  it("writes the same bytes with the cache and without it", async () => {
    const root = await gameTree();
    const cached = await temp();
    const cold = await temp();
    const cache = await temp();

    await pack(root, cached, cache);
    await pack(root, cached, cache);
    await pack(root, cold, false);

    expect(await snapshot(cold)).toEqual(await snapshot(cached));
  });

  it("reads a broken or half-written cache entry as a miss, and writes the same bytes", async () => {
    const root = await gameTree();
    const out = await temp();
    const cache = await temp();

    await pack(root, out, cache);

    const before = await snapshot(out);
    const entries = await readdir(cache);
    const [firstJson, secondJson] = entries.filter(name => name.endsWith(".json"));
    const blobs = entries.filter(name => name.endsWith(".webp"));

    // One entry of another shape, one whose JSON is cut, and every page blob gone.
    await writeFile(path.join(cache, firstJson ?? ""), JSON.stringify({ images: [{ width: 1 }] }));
    await writeFile(path.join(cache, secondJson ?? ""), "{");
    await Promise.all(blobs.map(name => rm(path.join(cache, name))));

    const second = await pack(root, out, cache);

    expect(second.cacheHits).toBe(0);
    expect(await snapshot(out)).toEqual(before);
  });

  it("names a texture whose pixels disagree with the size the scan read", async () => {
    const root = await gameTree();
    const source = await scanOf(root);
    const ui = bundleOf(source, "ui");
    const wrong: Manifest = {
      ...source,
      bundles: {
        ...source.bundles,
        ui: {
          ...ui,
          files: ui.files.map(file => (file.key === "ui.icon-a" ? { ...file, width: 21 } : file))
        }
      }
    };
    const out = await temp();

    await expect(
      packAssets({
        root,
        manifest: wrong,
        out,
        manifestFile: path.join(out, "manifest.json"),
        cache: false
      })
    ).rejects.toThrow('the texture "ui.icon-a" decodes to 20×20, not the 21×20 its header says.');
  });

  it("repacks only the group of a changed source", async () => {
    const root = await gameTree();
    const out = await temp();
    const cache = await temp();
    const first = await pack(root, out, cache);

    await writeFile(path.join(root, "features/ui/assets/icon-a.png"), await png(20, 20, RED));

    const second = await pack(root, out, cache);

    expect(second.cacheHits).toBe(1);
    expect(pagePathOf(second, "ui/fx-0")).toBe(pagePathOf(first, "ui/fx-0"));
    expect(pagePathOf(second, "ui/main-0")).not.toBe(pagePathOf(first, "ui/main-0"));
  });

  it("prunes every file the manifest does not reference, and keeps manifest.json", async () => {
    const root = await gameTree();
    const out = await temp();

    await mkdir(path.join(out, "ui"), { recursive: true });
    await mkdir(path.join(out, "gone", "deep"), { recursive: true });
    await writeFile(path.join(out, "ui", "main-0-0123456789.webp"), "stale");
    await writeFile(path.join(out, "gone", "deep", "old.mp3"), "stale");

    const { manifest } = await pack(root, out, false);
    const written = await snapshot(out);
    const files = [...written.keys()].toSorted();
    const referenced = Object.values(manifest.bundles).flatMap(bundle => [
      ...(bundle.pages ?? []).map(page => page.path),
      ...bundle.files.flatMap(file => [
        ...(file.path === undefined ? [] : [file.path]),
        ...(file.pages ?? []).map(page => page.path)
      ])
    ]);

    expect(files).toEqual(["manifest.json", ...referenced].toSorted());
    await expect(stat(path.join(out, "gone"))).rejects.toThrow();
  });

  it("collects every problem into one error and writes nothing", async () => {
    const root = await gameTree();
    const out = path.join(await temp(), "assets");

    // An fx texture one pixel above the room of the largest page fits no page; it is never loose.
    const largest = Math.max(...PAGE_SIZES);
    const over = roomOf(largest) + 1;

    await writeFile(path.join(root, "features/ui/assets/fx-huge.png"), await png(over, 4, RED));
    await writeFile(path.join(root, "features/ui/assets/fx-wide.png"), await png(4, over, RED));

    await expect(pack(root, out, false)).rejects.toThrow(
      "[game] assets: the pack found 2 problems.\n" +
        `  the texture "ui.fx-huge" (${over}×4) fits no ${largest}×${largest} page with its 2 px border and 2 px padding.\n` +
        `  the texture "ui.fx-wide" (4×${over}) fits no ${largest}×${largest} page with its 2 px border and 2 px padding.\n` +
        '  Fix them and run "bun run assets:pack" again.'
    );
    await expect(stat(out)).rejects.toThrow();
  });

  it("refuses a pack folder that holds the game sources", async () => {
    const root = await gameTree();

    await expect(pack(root, root, false)).rejects.toThrow(
      'holds the game sources.\n  Give the pack a folder of its own, like "dist/assets".'
    );
    await expect(stat(path.join(root, "features/ui/assets/icon-a.png"))).resolves.toBeDefined();
  });

  it("packs the files of a layer under the bundle of its mapped name", async () => {
    const root = await layeredTree();
    const out = await temp();
    const source = await scanOf(root, { shared: "ui" });
    const { manifest } = await packAssets({
      root,
      manifest: source,
      out,
      manifestFile: path.join(out, "manifest.json"),
      cache: false
    });
    const ui = bundleOf(manifest, "ui");
    const bg = fileOf(ui, "ui.bg");

    expect(keysOf(manifest)).toEqual(keysOf(source));
    expect(ui.feature).toBe("ui");
    expect(ui.pages?.map(page => page.id)).toEqual(["ui/main-0"]);
    expect(fileOf(ui, "ui.icon-a").atlas?.page).toBe("ui/main-0");
    expect(bg.path).toMatch(/^ui\/ui\.bg-[0-9a-f]{10}\.webp$/);
    expect(await readFile(path.join(out, bg.path ?? ""))).toEqual(
      await readFile(path.join(root, "shared/assets/bg.webp"))
    );
  });

  it("refuses a manifest that is already packed", async () => {
    const root = await gameTree();
    const out = await temp();
    const { manifest } = await pack(root, out, false);

    await expect(
      packAssets({
        root,
        manifest,
        out: await temp(),
        manifestFile: path.join(out, "again.json"),
        cache: false
      })
    ).rejects.toThrow('the texture "ui.fx-spark" has no path: pack the manifest of the scan.');
  });
});

describe("runCli --pack", () => {
  it("refuses --check: a pack writes files", async () => {
    const root = await gameTree();
    const ui = recorder();

    expect(
      await runCli(["--root", root, "--pack", path.join(root, "dist"), "--check"], noStrings, ui)
    ).toBe(1);
    expect(ui.lines).toEqual([`error [game] assets: "--pack" writes files; drop "--check".`]);
  });

  it("names the pack folder a --pack misses", async () => {
    const ui = recorder();

    expect(await runCli(["--root", ".", "--pack"], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual([`error [game] assets: "--pack" needs a path.`]);
  });

  it("packs on the dev keys, leaves the dev manifest alone and reports through the recorder", async () => {
    const root = await gameTree();
    const out = path.join(await temp(), "assets");

    expect(await runCli(["--root", root], noStrings, recorder())).toBe(0);

    const devManifest = await readFile(path.join(root, "manifest.json"), "utf8");
    const devKeys = await readFile(path.join(root, "generated", "assets.ts"), "utf8");
    const ui = recorder();

    expect(await runCli(["--root", root, "--pack", out, "--no-cache"], noStrings, ui)).toBe(0);

    const packed = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8")) as Manifest;
    const uiMb = bundleOf(packed, "ui").mb;

    expect(packed.version).toBe(2);
    expect(await readFile(path.join(root, "manifest.json"), "utf8")).toBe(devManifest);
    expect(await readFile(path.join(root, "generated", "assets.ts"), "utf8")).toBe(devKeys);
    expect(ui.lines.slice(0, 2)).toEqual([
      "info packed board: 0 pages, 1 loose, 0 fonts, 0 sounds, 0.006 MB",
      `info packed ui: 2 pages, 2 loose, 1 font, 1 sound, ${uiMb} MB`
    ]);
    expect(ui.lines[2]).toMatch(
      new RegExp(
        String.raw`^info wrote "${out.replaceAll("\\", "\\\\")}/manifest\.json": 2 pages, 3 loose files, 1 font, 1 sound, \d+ KB\. cache: off\.$`
      )
    );
  });

  it("writes the packed manifest where --manifest says, and counts the cache hits", async () => {
    const root = await gameTree();
    const out = path.join(await temp(), "assets");
    const manifestFile = path.join(await temp(), "packed.json");
    const work = await temp();
    const ui = recorder();

    // The cache folder is relative to the working directory: keep it out of the repository.
    vi.spyOn(process, "cwd").mockReturnValue(work);

    await runCli(
      ["--root", root, "--pack", out, "--manifest", manifestFile],
      noStrings,
      recorder()
    );
    expect(
      await runCli(["--root", root, "--pack", out, "--manifest", manifestFile], noStrings, ui)
    ).toBe(0);
    vi.restoreAllMocks();

    expect(JSON.parse(await readFile(manifestFile, "utf8"))).toMatchObject({ version: 2 });
    await expect(stat(path.join(out, "manifest.json"))).rejects.toThrow();
    await expect(
      stat(path.join(work, "node_modules", ".cache", "moku-game-pack"))
    ).resolves.toBeDefined();
    expect(ui.lines.at(-1)).toMatch(/cache: 2 of 2 pages\.$/);
  });

  it("scans the layers of --layer before it packs", async () => {
    const root = await layeredTree();
    const out = path.join(await temp(), "assets");
    const argv = ["--root", root, "--pack", out, "--no-cache", "--layer", "shared=ui"];

    expect(await runCli(argv, noStrings, recorder())).toBe(0);

    const packed = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8")) as Manifest;

    expect(Object.keys(packed.bundles)).toEqual(["board", "ui"]);
    expect(bundleOf(packed, "ui").feature).toBe("ui");
    expect(await readFile(path.join(root, "generated", "assets.ts"), "utf8")).toContain(
      '"ui.icon-a"'
    );
  });

  it("reports a pack problem as one error line and exit 1", async () => {
    const root = await gameTree();
    const ui = recorder();

    await writeFile(
      path.join(root, "features/ui/assets/fx-huge.png"),
      await png(roomOf(Math.max(...PAGE_SIZES)) + 1, 4, RED)
    );
    await rm(path.join(root, "features/ui/assets/fx-star.png"));

    expect(
      await runCli(
        ["--root", root, "--pack", path.join(await temp(), "assets"), "--no-cache"],
        noStrings,
        ui
      )
    ).toBe(1);
    expect(ui.lines.at(-1)).toContain("[game] assets: the pack found 1 problem.\n");
  });
});

describe("packAssets of a sub-feature", () => {
  it("keeps parent, dir and release, and a mipmapped texture loose with its chain megabytes", async () => {
    const root = await makeTree({
      "features/episodes/index.ts": "export {};\n",
      "features/episodes/ep01/index.ts": "export {};\n",
      "features/episodes/ep01/assets.ts":
        'export const a = { kind: "bundles", map: { ep01: { tier: "lazy", release: "leave", mipmaps: ["items/**"] } } };\n',
      "features/episodes/ep01/assets/a.png": await png(20, 20, BLUE),
      "features/episodes/ep01/assets/b.png": await png(24, 10, YELLOW),
      "features/episodes/ep01/assets/items/cup.png": await png(32, 32, RED)
    });

    folders.push(root);

    const { manifest } = await pack(root, await temp(), false);
    const ep01 = bundleOf(manifest, "ep01");
    const cup = fileOf(ep01, "ep01.items.cup");

    expect(ep01).toMatchObject({
      feature: "ep01",
      parent: "episodes",
      dir: "features/episodes/ep01",
      tier: "lazy",
      release: "leave"
    });
    // The two plain textures share a page; the mipmapped one stays a file of its own.
    expect(fileOf(ep01, "ep01.a").atlas?.page).toBe("ep01/main-0");
    expect(cup.atlas).toBeUndefined();
    expect(cup).toMatchObject({ mips: true, mb: textureMb(32, 32, true) });
    expect(ep01.mb).toBeCloseTo((ep01.pages?.[0]?.mb ?? 0) + cup.mb, 3);
  });
});

/** The tree of the trim tests: a texture with a 10 px transparent margin, an opaque one and an empty one. */
async function trimTree(): Promise<string> {
  const root = await makeTree({
    "features/ui/assets/icon.png": await pngOfPixels(40, 30, marginPixels(40, 30, 10)),
    "features/ui/assets/other.png": await png(20, 20, BLUE),
    "features/ui/assets/ghost.png": await pngOfPixels(30, 30, new Uint8Array(30 * 30 * 4))
  });

  folders.push(root);

  return root;
}

describe("packAssets trim (F198)", () => {
  it("packs a texture with a 10 px transparent margin as its visible pixels and the margin pixel, and records where it lay", async () => {
    // Bug caught: a frame without its offset and original size is drawn at the size of the cut, so
    // the sprite shrinks and shifts; the margin of 1 px keeps the edge reading transparent.
    const root = await trimTree();
    const { manifest } = await pack(root, await temp(), false);
    const ui = bundleOf(manifest, "ui");
    const icon = fileOf(ui, "ui.icon");

    expect(icon).toMatchObject({ key: "ui.icon", width: 40, height: 30, mb: 0 });
    expect(icon.atlas).toMatchObject({
      width: 40 - 18,
      height: 30 - 18,
      offsetX: 9,
      offsetY: 9,
      origWidth: 40,
      origHeight: 30
    });
    expect(Object.keys(icon.atlas ?? {})).toEqual([
      "page",
      "x",
      "y",
      "width",
      "height",
      "offsetX",
      "offsetY",
      "origWidth",
      "origHeight"
    ]);
  });

  it("composes the page with the source pixels of the frame, taken from the offset", async () => {
    // Bug caught: a crop from the wrong offset or row stride puts the wrong pixels in the page; it
    // is read on the composed RGBA, which the lossy WebP would blur.
    const root = await trimTree();

    spy.composed.length = 0;

    const { manifest } = await pack(root, await temp(), false);
    const ui = bundleOf(manifest, "ui");
    const atlas = fileOf(ui, "ui.icon").atlas;
    const page = ui.pages?.find(entry => entry.id === atlas?.page);
    const call = spy.composed.find(
      entry => entry.width === page?.width && entry.height === page?.height
    );
    const source = marginPixels(40, 30, 10);

    expect(atlas).toBeDefined();
    expect(call).toBeDefined();

    const rgba = composePage(call?.width ?? 0, call?.height ?? 0, call?.parts ?? []);

    for (let row = 0; row < (atlas?.height ?? 0); row += 1) {
      const onPage = ((atlas?.y ?? 0) + row) * (page?.width ?? 0) + (atlas?.x ?? 0);
      const inSource = ((atlas?.offsetY ?? 0) + row) * 40 + (atlas?.offsetX ?? 0);

      expect(rgba.subarray(onPage * 4, (onPage + (atlas?.width ?? 0)) * 4)).toEqual(
        source.subarray(inSource * 4, (inSource + (atlas?.width ?? 0)) * 4)
      );
    }
  });

  it("keeps a 1×1 frame for a fully transparent texture and the whole frame for an opaque one", async () => {
    // Bug caught: an empty frame of 0 px cannot be cut out of a page, and trimming an opaque
    // texture shifts it for nothing.
    const root = await trimTree();
    const { manifest } = await pack(root, await temp(), false);
    const ui = bundleOf(manifest, "ui");

    expect(fileOf(ui, "ui.ghost").atlas).toMatchObject({
      width: 1,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      origWidth: 30,
      origHeight: 30
    });
    expect(Object.keys(fileOf(ui, "ui.other").atlas ?? {})).toEqual([
      "page",
      "x",
      "y",
      "width",
      "height"
    ]);
    expect(fileOf(ui, "ui.other").atlas).toMatchObject({ width: 20, height: 20 });
  });

  it("never trims a nine-slice: the same margin leaves its full size and no offset fields", async () => {
    // Bug caught: a trimmed nine-slice loses its borders, which sit in the margin the cut removed.
    const root = await makeTree({
      "features/ui/assets/panel{nine=4}.png": await pngOfPixels(40, 30, marginPixels(40, 30, 10)),
      "features/ui/assets/other.png": await png(20, 20, BLUE)
    });

    folders.push(root);

    const { manifest } = await pack(root, await temp(), false);
    const panel = fileOf(bundleOf(manifest, "ui"), "ui.panel");

    expect(panel.nine).toEqual({ left: 4, top: 4, right: 4, bottom: 4 });
    expect(panel.atlas).toMatchObject({ width: 40, height: 30 });
    expect(Object.keys(panel.atlas ?? {})).toEqual(["page", "x", "y", "width", "height"]);
  });

  it("replays the trim of a frame from the cache with the same manifest and bytes", async () => {
    // Bug caught: a cache entry that drops the trim fields (or is read as another shape) gives a
    // second run whose frames are the cut at the original's size.
    const root = await trimTree();
    const out = await temp();
    const cache = await temp();
    const first = await pack(root, out, cache);
    const before = await snapshot(out);
    const second = await pack(root, out, cache);

    expect(second.cacheHits).toBe(second.pages);
    expect(second.cacheHits).toBeGreaterThan(0);
    expect(second.manifest).toEqual(first.manifest);
    expect(await snapshot(out)).toEqual(before);
  });
});

describe("packAssets loose by layout (F198)", () => {
  it("writes a main texture the chosen layout leaves loose as a file of its own, on a miss and on a hit", async () => {
    // Bug caught: a texture the layout left out of the pages and out of the loose list vanishes
    // from the pack, and the check names its key as missing.
    const root = await makeTree({
      "features/ui/assets/big.png": await png(2000, 1000, GREY),
      "features/ui/assets/a.png": await png(50, 50, RED),
      "features/ui/assets/b.png": await png(50, 50, GREEN)
    });

    folders.push(root);

    const out = await temp();
    const cache = await temp();
    const first = await pack(root, out, cache);
    const before = await snapshot(out);
    const second = await pack(root, out, cache);

    for (const result of [first, second]) {
      const ui = bundleOf(result.manifest, "ui");

      expect(fileOf(ui, "ui.big").atlas).toBeUndefined();
      expect(fileOf(ui, "ui.big").path).toMatch(/^ui\/ui\.big-[0-9a-f]{10}\.webp$/);
      expect(fileOf(ui, "ui.a").atlas?.page).toBe("ui/main-0");
      expect(result.pages).toBe(1);
      expect(result.loose).toBe(1);
    }

    expect(second.cacheHits).toBe(1);
    expect(await snapshot(out)).toEqual(before);
  });
});
