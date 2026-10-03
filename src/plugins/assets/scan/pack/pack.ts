/**
 * @file assets packer, build time — `packAssets`: stage the atlas groups of every bundle, pack and
 * encode them, copy the fonts, the sounds and the loose WebP files, check that every key landed,
 * then write the pack folder and prune it. This is the only file that touches the pack folder;
 * nothing is written there while a problem is open.
 */
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AtlasPage, Manifest, ManifestBundle, ManifestFile } from "../../types";
import { emitManifest } from "../emit";
import { textureMb } from "../image-size";
import { type CachedImage, cacheKey, readCache, sha256, writeCache } from "./cache";
import { type Copied, copyAudio, copyFont, copyLoose, extensionOf, readSource } from "./copy";
import { type Encoder, loadEncoder, type PagePart } from "./encode";
import { type Group, planGroups } from "./groups";
import { type LayoutFrame, layoutGroup } from "./layout";
import { contentHash, looseName, pageId, pageName } from "./names";

/**
 * What one pack is told: where the sources are, what the scan found and where everything goes.
 */
export type PackOptions = {
  /** Path of the game source root: the `path` of every file of `manifest` is relative to it. */
  root: string;
  /** The manifest the scan produced (version 1, loose files). */
  manifest: Manifest;
  /** The pack folder. It belongs to the command: created, written and pruned. */
  out: string;
  /** Where the packed manifest (version 2) goes. */
  manifestFile: string;
  /** The cache folder, or `false` for a run that neither reads nor writes the cache. */
  cache: string | false;
};

/**
 * What a pack wrote.
 */
export type PackResult = {
  /** The packed manifest, version 2, as written. */
  manifest: Manifest;
  /** How many atlas pages the pack folder holds. */
  pages: number;
  /** How many textures stayed files of their own. */
  loose: number;
  /** The bytes of every file the manifest references. */
  bytes: number;
  /** How many of the pages were replayed from the cache. */
  cacheHits: number;
};

/** A texture of the scan, with its source bytes and their SHA-256. */
type Source = {
  key: string;
  width: number;
  height: number;
  file: ManifestFile;
  bytes: Uint8Array;
  sha: string;
};

/** What one pack run collects on its way. */
type PackRun = {
  root: string;
  cache: string | false;
  encoder: Encoder;
  /** POSIX path inside the pack folder to the bytes it gets. */
  outputs: Map<string, Uint8Array>;
  problems: string[];
  cacheHits: number;
};

/** The pack folder keeps a file of this name even when the manifest goes elsewhere. */
const MANIFEST_NAME = "manifest.json";

/** What the problems of a file call its kind. */
const KIND_WORD = { texture: "texture", font: "font", audio: "sound" } as const;

/**
 * Creates an empty map. It lives in its own non-exported function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Lists the keys of two maps once each, for the same reason as `emptyMap`.
 *
 * @param left - One map.
 * @param right - Another map.
 * @returns Every key of either, without repeats.
 */
function keysOfBoth(
  left: ReadonlyMap<string, unknown>,
  right: ReadonlyMap<string, unknown>
): string[] {
  return [...new Set([...left.keys(), ...right.keys()])];
}

/**
 * Reads the message of anything that was thrown.
 *
 * @param failure - What the `catch` caught.
 * @returns The message.
 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Collects every problem of a pack into one error, so a game fixes its art in one round.
 *
 * @param problems - The problems, in pack order.
 * @returns The error to reject with.
 */
function collected(problems: readonly string[]): Error {
  const count = problems.length;
  const lines = problems.map(text => `  ${text}`).join("\n");

  return new Error(
    `[game] assets: the pack found ${count} problem${count === 1 ? "" : "s"}.\n${lines}\n` +
      '  Fix them and run "bun run assets:pack" again.'
  );
}

/**
 * Adds up what a list of entries costs.
 *
 * @param entries - Pages and files, each with an `mb`.
 * @returns The sum in MB, rounded to three decimals.
 */
function sumMb(entries: readonly { mb: number }[]): number {
  let total = 0;

  for (const entry of entries) total += entry.mb;

  return Math.round(total * 1000) / 1000;
}

/**
 * Reads the path of a file of the scan. A file without one comes from a packed manifest, which
 * the packer cannot read its sources from.
 *
 * @param run - The pack run, which collects the problem.
 * @param file - A file of the scanned manifest.
 * @returns The path, or `undefined` after a problem.
 */
function sourcePathOf(run: PackRun, file: ManifestFile): string | undefined {
  if (file.path !== undefined) return file.path;

  run.problems.push(
    `the ${KIND_WORD[file.kind ?? "texture"]} "${file.key}" has no path: pack the manifest of the scan.`
  );

  return undefined;
}

/**
 * Reads the source of every texture of a bundle and hashes it.
 *
 * @param run - The pack run.
 * @param bundle - The bundle of the scan.
 * @returns The textures with their bytes, in manifest order.
 */
async function readTextures(run: PackRun, bundle: ManifestBundle): Promise<Source[]> {
  const sources: Source[] = [];

  for (const file of bundle.files.filter(entry => (entry.kind ?? "texture") === "texture")) {
    const at = sourcePathOf(run, file);

    if (at === undefined) continue;

    try {
      const bytes = await readSource(run.root, at);

      sources.push({
        key: file.key,
        width: file.width,
        height: file.height,
        file,
        bytes,
        sha: sha256(bytes)
      });
    } catch (error) {
      run.problems.push(`the file "${at}" could not be read: ${messageOf(error)}`);
    }
  }

  return sources;
}

/**
 * Decodes the textures of one layout page and composes the page.
 *
 * @param run - The pack run.
 * @param page - The size and the frames of the page.
 * @param page.width - Width of the page.
 * @param page.height - Height of the page.
 * @param page.frames - Where each texture lies.
 * @param sources - The members of the group, by key.
 * @returns The page, encoded.
 */
async function encodePage(
  run: PackRun,
  page: { width: number; height: number; frames: readonly LayoutFrame[] },
  sources: ReadonlyMap<string, Source>
): Promise<CachedImage> {
  const parts: PagePart[] = [];

  for (const frame of page.frames) {
    const source = sources.get(frame.key);

    if (source === undefined) continue;

    const pixels = await run.encoder.decode(source.bytes);

    // The frame was laid out by the size of the header; the pixels must agree with it.
    if (pixels.width !== frame.width || pixels.height !== frame.height) {
      run.problems.push(
        `the texture "${frame.key}" decodes to ${pixels.width}×${pixels.height}, ` +
          `not the ${frame.width}×${frame.height} its header says.`
      );
      continue;
    }

    parts.push({ pixels, x: frame.x, y: frame.y });
  }

  const bytes = await run.encoder.page(page.width, page.height, parts);

  return { width: page.width, height: page.height, frames: page.frames, bytes };
}

/**
 * Packs one atlas group into pages: from the cache when every member is unchanged, otherwise laid
 * out, composed and encoded, and stored in the cache when nothing went wrong.
 *
 * @param run - The pack run.
 * @param bundle - Name of the bundle.
 * @param group - The atlas group.
 * @param members - Its textures, sorted by key.
 * @returns The encoded pages with their frames.
 */
async function packGroup(
  run: PackRun,
  bundle: string,
  group: Group,
  members: readonly Source[]
): Promise<CachedImage[]> {
  const key = cacheKey({
    kind: "atlas",
    sharp: run.encoder.version,
    members: members.map(member => ({
      key: member.key,
      source: member.sha,
      nine: member.file.nine
    }))
  });
  const cached = await readCache(run.cache, key);

  if (cached !== undefined) {
    run.cacheHits += cached.length;

    return cached;
  }

  const open = run.problems.length;
  const layout = layoutGroup(bundle, group, members);
  const sources = new Map(members.map(member => [member.key, member]));
  const images: CachedImage[] = [];

  run.problems.push(...layout.problems);

  for (const page of layout.pages) images.push(await encodePage(run, page, sources));

  if (run.problems.length === open) await writeCache(run.cache, key, images);

  return images;
}

/**
 * Writes the entry of a texture cut out of a page: no `path`, no cost of its own, the frame.
 *
 * @param file - The texture of the scan.
 * @param page - The id of its page.
 * @param frame - Where it lies on the page.
 * @returns The packed entry.
 */
function packedFile(file: ManifestFile, page: string, frame: LayoutFrame): ManifestFile {
  return {
    key: file.key,
    width: file.width,
    height: file.height,
    mb: 0,
    ...(file.nine === undefined ? {} : { nine: file.nine }),
    atlas: { page, x: frame.x, y: frame.y, width: frame.width, height: frame.height }
  };
}

/**
 * Writes one loose texture: a WebP source is copied byte for byte, a PNG source is encoded to
 * WebP, through the cache.
 *
 * @param run - The pack run.
 * @param bundle - Name of the bundle.
 * @param source - The texture and its bytes.
 * @returns The packed entry and the file it writes.
 */
async function looseTexture(run: PackRun, bundle: string, source: Source): Promise<Copied> {
  if (extensionOf(source.file.path ?? "") === "webp") {
    return copyLoose(bundle, source.file, source.bytes);
  }

  const key = cacheKey({
    kind: "loose",
    sharp: run.encoder.version,
    members: [{ key: source.key, source: source.sha, nine: source.file.nine }]
  });
  const cached = await readCache(run.cache, key);
  const bytes = cached?.[0]?.bytes ?? (await run.encoder.webp(source.bytes));

  if (cached === undefined) {
    await writeCache(run.cache, key, [
      { width: source.width, height: source.height, frames: [], bytes }
    ]);
  }

  const name = looseName(bundle, source.key, contentHash(bytes), "webp");

  return { file: { ...source.file, path: name }, outputs: [{ path: name, bytes }] };
}

/**
 * Copies the fonts and the sounds of a bundle.
 *
 * @param run - The pack run.
 * @param bundle - Name of the bundle.
 * @param files - The files of the bundle.
 * @returns What each copy wrote.
 */
async function copyOthers(
  run: PackRun,
  bundle: string,
  files: readonly ManifestFile[]
): Promise<Copied[]> {
  const copies: Copied[] = [];

  for (const file of files.filter(entry => entry.kind === "font" || entry.kind === "audio")) {
    const at = sourcePathOf(run, file);

    if (at === undefined) continue;

    try {
      copies.push(
        file.kind === "font"
          ? await copyFont(run.root, bundle, file, at)
          : await copyAudio(run.root, bundle, file, at)
      );
    } catch (error) {
      run.problems.push(
        `the ${KIND_WORD[file.kind ?? "texture"]} "${file.key}" could not be copied: ${messageOf(error)}`
      );
    }
  }

  return copies;
}

/**
 * Packs one bundle: its atlas groups become pages, the rest is written loose or copied.
 *
 * @param run - The pack run, which collects the files to write.
 * @param name - Name of the bundle.
 * @param bundle - The bundle of the scan.
 * @returns The packed bundle.
 */
async function packBundle(
  run: PackRun,
  name: string,
  bundle: ManifestBundle
): Promise<ManifestBundle> {
  const plan = planGroups(await readTextures(run, bundle));
  const pages: AtlasPage[] = [];
  const files: ManifestFile[] = [];

  for (const [group, members] of plan.groups) {
    const images = await packGroup(run, name, group, members);
    const byKey = new Map(members.map(member => [member.key, member.file]));

    for (const [index, image] of images.entries()) {
      const id = pageId(name, group, index);
      const file = pageName(name, group, index, contentHash(image.bytes));

      run.outputs.set(file, image.bytes);
      pages.push({
        id,
        path: file,
        width: image.width,
        height: image.height,
        mb: textureMb(image.width, image.height)
      });

      for (const frame of image.frames) {
        const source = byKey.get(frame.key);

        if (source !== undefined) files.push(packedFile(source, id, frame));
      }
    }
  }

  const copies = [
    ...(await Promise.all(plan.loose.map(source => looseTexture(run, name, source)))),
    ...(await copyOthers(run, name, bundle.files))
  ];

  for (const copy of copies) {
    files.push(copy.file);

    for (const output of copy.outputs) run.outputs.set(output.path, output.bytes);
  }

  return {
    feature: bundle.feature,
    tier: bundle.tier,
    mb: sumMb([...pages, ...files.filter(file => file.atlas === undefined)]),
    ...(pages.length === 0
      ? {}
      : { pages: pages.toSorted((left, right) => left.id.localeCompare(right.id)) }),
    files: files.toSorted((left, right) => left.key.localeCompare(right.key))
  };
}

/**
 * Checks one packed texture against its page and its source.
 *
 * @param bundle - Name of the bundle.
 * @param entry - The packed bundle.
 * @param file - One of its textures.
 * @param source - The same texture in the scan.
 * @returns The problems, empty when the file is right.
 */
function checkTexture(
  bundle: string,
  entry: ManifestBundle,
  file: ManifestFile,
  source: ManifestFile | undefined
): string[] {
  const atlas = file.atlas;

  if ((atlas === undefined) === (file.path === undefined)) {
    return [`the texture "${file.key}" must have either a path or an atlas frame.`];
  }

  if (atlas === undefined) return [];

  const page = entry.pages?.find(candidate => candidate.id === atlas.page);

  if (page === undefined) {
    return [
      `the texture "${file.key}" names page "${atlas.page}", which bundle "${bundle}" does not list.`
    ];
  }

  const problems: string[] = [];
  const inside =
    atlas.x >= 0 &&
    atlas.y >= 0 &&
    atlas.x + atlas.width <= page.width &&
    atlas.y + atlas.height <= page.height;

  if (!inside) {
    problems.push(
      `the frame of "${file.key}" lies outside page "${page.id}" (${page.width}×${page.height}).`
    );
  }

  if (atlas.width !== source?.width || atlas.height !== source.height) {
    problems.push(
      `the frame of "${file.key}" is ${atlas.width}×${atlas.height}, its source ` +
        `${source?.width ?? 0}×${source?.height ?? 0}.`
    );
  }

  return problems;
}

/**
 * Checks a packed manifest against the scan it came from: every key landed exactly once, as a
 * page frame or a file; every frame names a page of its own bundle, lies inside it and has the
 * size of its source, so `nine` stays valid as it is.
 *
 * @param source - The manifest of the scan.
 * @param packed - The packed manifest.
 * @returns One sentence per problem, empty when the pack is right.
 * @example
 * ```ts
 * checkPacked(emptyManifest(), { version: 2, bundles: {} }); // []
 * ```
 */
export function checkPacked(source: Manifest, packed: Manifest): string[] {
  const problems: string[] = [];
  const scanned = emptyMap<string, ManifestFile>();
  const landed = emptyMap<string, number>();

  for (const bundle of Object.values(source.bundles)) {
    for (const file of bundle.files) scanned.set(file.key, file);
  }

  for (const [name, entry] of Object.entries(packed.bundles)) {
    for (const file of entry.files) {
      landed.set(file.key, (landed.get(file.key) ?? 0) + 1);

      if ((file.kind ?? "texture") === "texture") {
        problems.push(...checkTexture(name, entry, file, scanned.get(file.key)));
      }
    }
  }

  for (const key of keysOfBoth(scanned, landed)) {
    const count = landed.get(key) ?? 0;

    if (!scanned.has(key)) problems.push(`the key "${key}" is in the pack but not in the scan.`);
    else if (count !== 1) problems.push(`the key "${key}" landed ${count} times, not once.`);
  }

  return problems;
}

/**
 * Tells whether a file already holds these bytes, so an unchanged file is not written again.
 *
 * @param file - Path of the file.
 * @param bytes - What it should hold.
 * @returns True when it does.
 */
async function holds(file: string, bytes: Uint8Array): Promise<boolean> {
  try {
    return Buffer.from(await readFile(file)).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * Writes one file when its bytes changed.
 *
 * @param file - Path of the file.
 * @param bytes - What it should hold.
 */
async function writeChanged(file: string, bytes: Uint8Array): Promise<void> {
  if (await holds(file, bytes)) return;

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/**
 * Deletes every file under a folder that is not kept, and every folder that ends up empty.
 *
 * @param folder - The folder to prune.
 * @param keep - Absolute paths of the files to keep.
 * @returns True when the folder is empty afterwards.
 */
async function prune(folder: string, keep: ReadonlySet<string>): Promise<boolean> {
  let empty = true;

  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const target = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (await prune(target, keep)) await rmdir(target);
      else empty = false;
    } else if (keep.has(target)) {
      empty = false;
    } else {
      await rm(target, { force: true });
    }
  }

  return empty;
}

/**
 * Writes the pack folder: every output whose bytes changed, then the manifest, then the prune
 * that leaves exactly what the manifest references, plus `manifest.json`.
 *
 * @param options - The pack folder and the manifest file.
 * @param options.out - The pack folder.
 * @param options.manifestFile - Where the packed manifest goes.
 * @param outputs - POSIX path inside the pack folder to the bytes it gets.
 * @param manifestText - The packed manifest as `emitManifest` wrote it.
 * @returns The bytes of every output.
 */
async function writePack(
  options: { out: string; manifestFile: string },
  outputs: ReadonlyMap<string, Uint8Array>,
  manifestText: string
): Promise<number> {
  const out = path.resolve(options.out);
  const manifestFile = path.resolve(options.manifestFile);
  const keep = new Set([manifestFile, path.join(out, MANIFEST_NAME)]);
  let bytes = 0;

  for (const [relative, content] of outputs) {
    const file = path.join(out, ...relative.split("/"));

    keep.add(file);
    bytes += content.byteLength;
    await writeChanged(file, content);
  }

  await writeChanged(manifestFile, new TextEncoder().encode(manifestText));
  await mkdir(out, { recursive: true });
  await prune(out, keep);

  return bytes;
}

/**
 * Tells whether the pack folder holds the game sources: pruning it would delete them.
 *
 * @param out - The pack folder.
 * @param root - The game source root.
 * @returns True when the root is the pack folder or inside it.
 */
function holdsSources(out: string, root: string): boolean {
  const relative = path.relative(path.resolve(out), path.resolve(root));

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Packs the art of a game for production: per bundle, the textures of the `fx` group and of the
 * `main` group go onto WebP atlas pages (2048 px at most, 2 px padding and border, never trimmed
 * or rotated), a texture with a side above 512 px and a group of one stay loose files, fonts and
 * sounds are copied, every file name carries the hash of its bytes, and the packed manifest
 * (version 2) names it all. Nothing is written while a problem is open; afterwards the pack folder
 * holds exactly what the manifest references, plus `manifest.json`. Two runs on the same tree and
 * the same `sharp` write the same bytes.
 *
 * @param options - The sources, the scanned manifest, the pack folder, the manifest file, the cache.
 * @returns The packed manifest and what was written.
 * @throws {Error} One error that lists every problem, when `sharp` is missing, or when the pack
 *   folder holds the sources.
 * @example
 * ```ts
 * // After `scanAssets` read the features of the game.
 * const { manifest, pages, cacheHits } = await packAssets({
 *   root: "src",
 *   manifest: scanned,
 *   out: "dist/assets",
 *   manifestFile: "dist/assets/manifest.json",
 *   cache: "node_modules/.cache/moku-game-pack"
 * });
 * // manifest.version: 2; on a second run with the same art, cacheHits equals pages
 * ```
 */
export async function packAssets(options: PackOptions): Promise<PackResult> {
  if (holdsSources(options.out, options.root)) {
    throw new Error(
      `[game] assets: the pack folder "${options.out}" holds the game sources.\n` +
        '  Give the pack a folder of its own, like "dist/assets".'
    );
  }

  const run: PackRun = {
    root: options.root,
    cache: options.cache,
    encoder: await loadEncoder(),
    outputs: emptyMap(),
    problems: [],
    cacheHits: 0
  };
  const bundles: Record<string, ManifestBundle> = {};

  for (const name of Object.keys(options.manifest.bundles).toSorted((left, right) =>
    left.localeCompare(right)
  )) {
    const bundle = options.manifest.bundles[name];

    if (bundle !== undefined) bundles[name] = await packBundle(run, name, bundle);
  }

  const manifest: Manifest = { version: 2, bundles };

  // A key that fits no page already has its problem; the checks are for the pack that went through.
  if (run.problems.length === 0) run.problems.push(...checkPacked(options.manifest, manifest));
  if (run.problems.length > 0) throw collected(run.problems);

  const bytes = await writePack(options, run.outputs, emitManifest(manifest));
  const all = Object.values(bundles);

  return {
    manifest,
    pages: all.reduce((count, bundle) => count + (bundle.pages?.length ?? 0), 0),
    loose: all.reduce(
      (count, bundle) =>
        count +
        bundle.files.filter(file => file.kind === undefined && file.path !== undefined).length,
      0
    ),
    bytes,
    cacheHits: run.cacheHits
  };
}
