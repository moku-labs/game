import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type ScanUi, type StringsCompiler } from "../../scan/cli";
import { type PackResult, packAssets } from "../../scan/pack/pack";
import { scanAssets } from "../../scan/scan";
import type { Manifest, ManifestBundle, ManifestFile } from "../../types";
import { audioBytes, bmfontText, makeTree, removeTree } from "./scan-fixtures";

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
    "features/ui/assets/bg.webp": await webp(600, 20, GREY),
    "features/ui/assets/big.png": await png(520, 8, GREY),
    "features/ui/assets/body.fnt": bmfontText("body_0.png"),
    "features/ui/assets/body_0.png": await png(16, 16, GREY),
    "features/ui/assets/click.mp3": audioBytes(2048),
    "features/board/assets/cell.png": await png(40, 40, GREEN)
  });

  folders.push(root);

  return root;
}

/** Scans a tree without writing anything, for the v1 manifest the packer reads. */
async function scanOf(root: string): Promise<Manifest> {
  const scratch = await temp();
  const { manifest } = await scanAssets({
    root,
    manifest: path.join(scratch, "manifest.json"),
    keys: path.join(scratch, "assets.ts"),
    write: false
  });

  return manifest;
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

/** A strings compiler for a game with no strings. */
const noStrings: StringsCompiler = () =>
  Promise.resolve({ changed: false, locales: [], keys: [], notes: [] });

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map(folder => removeTree(folder)));
});

describe("packAssets", () => {
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
    expect(big).toMatchObject({ width: 520, height: 8, mb: 0.016 });
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

    await writeFile(path.join(root, "features/ui/assets/fx-huge.png"), await png(2050, 4, RED));
    await writeFile(path.join(root, "features/ui/assets/fx-wide.png"), await png(4, 2047, RED));

    await expect(pack(root, out, false)).rejects.toThrow(
      "[game] assets: the pack found 2 problems.\n" +
        '  the texture "ui.fx-huge" (2050×4) fits no 2048×2048 page with a 2 px border.\n' +
        '  the texture "ui.fx-wide" (4×2047) fits no 2048×2048 page with a 2 px border.\n' +
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

  it("reports a pack problem as one error line and exit 1", async () => {
    const root = await gameTree();
    const ui = recorder();

    await writeFile(path.join(root, "features/ui/assets/fx-huge.png"), await png(2050, 4, RED));
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
