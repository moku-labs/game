/**
 * @file assets packer, build time — `packAssets`: stage the atlas groups of every bundle, pack and
 * encode them, copy the fonts, the sounds and the loose WebP files, check that every key landed,
 * then write the pack folder and prune it. This is the only file that touches the pack folder;
 * nothing is written there while a problem is open.
 */
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AtlasFrame, AtlasPage, Manifest, ManifestBundle, ManifestFile } from "../../types";
import { emitManifest } from "../emit";
import { textureMb } from "../image-size";
import { type CachedImage, cacheKey, readCache, sha256, writeCache } from "./cache";
import { type Copied, copyAudio, copyFont, copyLoose, extensionOf, readSource } from "./copy";
import { type Encoder, loadEncoder, type PagePart, type Pixels } from "./encode";
import { type Group, planGroups } from "./groups";
import { type Boxed, type LayoutFrame, type LayoutPage, layoutGroup, type Trim } from "./layout";
import { contentHash, looseName, pageId, pageName } from "./names";
import { cropPixels, trimBox } from "./trim";

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
  /** One line per group of texture files with the same bytes under different keys. */
  notes: string[];
};

/** A texture of the scan, with its source bytes and their SHA-256. */
type Source = {
  key: string;
  width: number;
  height: number;
  mips?: true;
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
  /** SHA-256 of a texture source to every texture read with those bytes, in reading order. */
  twins: Map<string, { key: string; bundle: string; width: number; height: number }[]>;
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
        ...(file.mips === true ? { mips: true } : {}),
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
 * A decoded member of a group: the pixels that go on the page (the cut, when its transparent margin
 * was trimmed) and, when it was cut, where the cut lay in the original.
 */
type Cut = { source: Source; pixels: Pixels; trim?: Trim };

/**
 * Cuts the transparent margin off a decoded texture, except the margin of a nine-slice: a trimmed
 * nine-slice would lose its borders, so it keeps its full image.
 *
 * @param source - The texture.
 * @param pixels - Its decoded pixels, at the size of its header.
 * @returns What goes on the page, with the trim when the image got smaller.
 */
function cutOf(source: Source, pixels: Pixels): Cut {
  if (source.file.nine !== undefined) return { source, pixels };

  const box = trimBox(pixels);

  if (box.width === pixels.width && box.height === pixels.height) return { source, pixels };

  return {
    source,
    pixels: cropPixels(pixels, box),
    trim: { offsetX: box.x, offsetY: box.y, origWidth: pixels.width, origHeight: pixels.height }
  };
}

/**
 * Decodes every member of a group once and cuts its margin. A texture whose pixels disagree with the
 * size of its header is a problem, and is left out.
 *
 * @param run - The pack run, which collects the problems.
 * @param members - The textures of the group.
 * @returns The cuts of the members that decoded to their header size, in member order.
 */
async function decodeGroup(run: PackRun, members: readonly Source[]): Promise<Cut[]> {
  const cuts: Cut[] = [];

  for (const member of members) {
    const pixels = await run.encoder.decode(member.bytes);

    // The layout is made on sizes; the pixels must agree with the header the group was planned by.
    if (pixels.width !== member.width || pixels.height !== member.height) {
      run.problems.push(
        `the texture "${member.key}" decodes to ${pixels.width}×${pixels.height}, ` +
          `not the ${member.width}×${member.height} its header says.`
      );
      continue;
    }

    cuts.push(cutOf(member, pixels));
  }

  return cuts;
}

/**
 * Tells the cuts that go to the layout from the ones that repeat the pixels of an earlier cut. A
 * repeat is laid out with the cut it repeats: its key gets the same rectangle of the page.
 *
 * @param cuts - The cuts of a group, in key order.
 * @returns The cuts to lay out, and each repeat under the key of the cut it repeats.
 */
function splitRepeats(cuts: readonly Cut[]): { first: Cut[]; repeats: Map<string, Cut[]> } {
  const seen = new Map<string, Cut>();
  const first: Cut[] = [];
  const repeats = new Map<string, Cut[]>();

  for (const cut of cuts) {
    const print = `${cut.pixels.width}x${cut.pixels.height}:${sha256(cut.pixels.data)}`;
    const earlier = seen.get(print);

    if (earlier === undefined) {
      seen.set(print, cut);
      first.push(cut);
      continue;
    }

    repeats.set(earlier.source.key, [...(repeats.get(earlier.source.key) ?? []), cut]);
  }

  return { first, repeats };
}

/**
 * Gives every repeat a frame on the rectangle of the cut it repeats, with the repeat's own trim.
 *
 * @param page - A page of the layout, with one frame per laid-out cut.
 * @param repeats - The repeats, under the key of the cut each one repeats.
 * @returns The page with the frames of the repeats added, sorted by key.
 */
function withRepeats(page: LayoutPage, repeats: ReadonlyMap<string, readonly Cut[]>): LayoutPage {
  const frames = page.frames.flatMap(frame => [
    frame,
    ...(repeats.get(frame.key) ?? []).map(cut => ({
      key: cut.source.key,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      ...cut.trim
    }))
  ]);

  return { ...page, frames: frames.toSorted((left, right) => left.key.localeCompare(right.key)) };
}

/**
 * Composes one layout page from the cut pixels of its frames and encodes it.
 *
 * @param run - The pack run.
 * @param page - The size and the frames of the page.
 * @param page.width - Width of the page.
 * @param page.height - Height of the page.
 * @param page.frames - Where each texture lies.
 * @param cuts - The cut of every member of the group, by key.
 * @returns The page, encoded.
 */
async function encodePage(
  run: PackRun,
  page: { width: number; height: number; frames: readonly LayoutFrame[] },
  cuts: ReadonlyMap<string, Cut>
): Promise<CachedImage> {
  const parts: PagePart[] = [];

  for (const frame of page.frames) {
    const cut = cuts.get(frame.key);

    if (cut !== undefined) parts.push({ pixels: cut.pixels, x: frame.x, y: frame.y });
  }

  const bytes = await run.encoder.page(page.width, page.height, parts);

  return { width: page.width, height: page.height, frames: page.frames, bytes };
}

/**
 * Lists the members of a group as the layout takes them: the size of the cut, and where it lay.
 *
 * @param cuts - The cuts of the group.
 * @returns One member per cut.
 */
function boxedOf(cuts: readonly Cut[]): Boxed[] {
  return cuts.map(cut => ({
    key: cut.source.key,
    width: cut.pixels.width,
    height: cut.pixels.height,
    ...(cut.trim === undefined ? {} : { trim: cut.trim })
  }));
}

/**
 * Packs one atlas group into pages: from the cache when every member is unchanged, otherwise every
 * member is decoded once and its transparent margin cut, the layout is chosen on the sizes of the
 * cuts, the pages are composed from them and encoded, and the entry is stored in the cache when
 * nothing went wrong.
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

  // Decode every member once and cut its margin; identical cuts are laid out once.
  const { first, repeats } = splitRepeats(await decodeGroup(run, members));
  const byKey = new Map(first.map(cut => [cut.source.key, cut]));
  const images: CachedImage[] = [];

  // Lay the cuts out on pages; what the layout refuses is a problem.
  const layout = layoutGroup(bundle, group, boxedOf(first));

  run.problems.push(...layout.problems);

  // Compose and encode each page, and cache the group when nothing went wrong. A repeat has a frame
  // and no cut of its own, so its pixels are drawn once.
  for (const page of layout.pages) {
    images.push(await encodePage(run, withRepeats(page, repeats), byKey));
  }

  if (run.problems.length === open) await writeCache(run.cache, key, images);

  return images;
}

/**
 * Reads the trim of a frame: where its texture lay in the original, when the texture was cut.
 *
 * @param frame - The frame of a page or of the manifest.
 * @returns The four trim fields, or `undefined` for a texture that is the whole image.
 */
function trimOf(frame: Partial<Trim>): Trim | undefined {
  const { offsetX, offsetY, origWidth, origHeight } = frame;

  if (
    offsetX === undefined ||
    offsetY === undefined ||
    origWidth === undefined ||
    origHeight === undefined
  ) {
    return undefined;
  }

  return { offsetX, offsetY, origWidth, origHeight };
}

/**
 * Writes the entry of a texture cut out of a page: no `path`, no cost of its own, the frame. The
 * frame carries `offsetX`, `offsetY`, `origWidth` and `origHeight` after `height`, only when the
 * texture was trimmed.
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
    atlas: {
      page,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      ...trimOf(frame)
    }
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

/** What the atlas groups of one bundle became: the pages and the textures cut out of them. */
type PackedGroups = { pages: AtlasPage[]; files: ManifestFile[] };

/**
 * Hands one encoded page to the pack folder under its hashed name.
 *
 * @param run - The pack run, which collects the files to write.
 * @param id - The id of the page.
 * @param file - Its hashed file name.
 * @param image - The encoded page.
 * @returns The page entry of the manifest.
 */
function writePage(run: PackRun, id: string, file: string, image: CachedImage): AtlasPage {
  run.outputs.set(file, image.bytes);

  return {
    id,
    path: file,
    width: image.width,
    height: image.height,
    mb: textureMb(image.width, image.height)
  };
}

/**
 * Writes the entries of the textures cut out of one page.
 *
 * @param image - The encoded page with its frames.
 * @param page - The id of the page.
 * @param byKey - The textures of the scan in its group, by key.
 * @returns One packed entry per frame of a known texture.
 */
function framedFiles(
  image: CachedImage,
  page: string,
  byKey: ReadonlyMap<string, ManifestFile>
): ManifestFile[] {
  return image.frames.flatMap(frame => {
    const source = byKey.get(frame.key);

    return source === undefined ? [] : [packedFile(source, page, frame)];
  });
}

/**
 * Packs the atlas groups of one bundle into pages, and writes the entry of every texture on them.
 *
 * @param run - The pack run, which collects the files to write.
 * @param bundle - Name of the bundle.
 * @param groups - The atlas groups of the bundle with their textures.
 * @returns The pages and the packed textures.
 */
async function packGroups(
  run: PackRun,
  bundle: string,
  groups: ReadonlyMap<Group, readonly Source[]>
): Promise<PackedGroups> {
  const packed: PackedGroups = { pages: [], files: [] };

  for (const [group, members] of groups) {
    const images = await packGroup(run, bundle, group, members);
    const byKey = new Map(members.map(member => [member.key, member.file]));

    // Each page is named by its content; its textures point at its id.
    for (const [index, image] of images.entries()) {
      const name = pageName(bundle, group, index, contentHash(image.bytes));
      const page = writePage(run, pageId(bundle, group, index), name, image);

      packed.pages.push(page);
      packed.files.push(...framedFiles(image, page.id, byKey));
    }
  }

  return packed;
}

/**
 * Writes what stays a file of its own: the loose textures as WebP, the fonts and the sounds as
 * copies.
 *
 * @param run - The pack run, which collects the files to write.
 * @param bundle - Name of the bundle.
 * @param loose - The textures no atlas group took.
 * @param files - Every file of the bundle in the scan.
 * @returns The entries of the written files.
 */
async function packLoose(
  run: PackRun,
  bundle: string,
  loose: readonly Source[],
  files: readonly ManifestFile[]
): Promise<ManifestFile[]> {
  const copies = [
    ...(await Promise.all(loose.map(source => looseTexture(run, bundle, source)))),
    ...(await copyOthers(run, bundle, files))
  ];

  for (const copy of copies) {
    for (const output of copy.outputs) run.outputs.set(output.path, output.bytes);
  }

  return copies.map(copy => copy.file);
}

/**
 * Writes one line per group of textures that were read with the same bytes under different keys.
 *
 * @param twins - SHA-256 of a source to the textures read with those bytes.
 * @returns The lines, sorted by the first key of each group.
 */
function twinNotes(twins: PackRun["twins"]): string[] {
  return [...twins.values()]
    .filter(group => group.length > 1)
    .map(group => group.toSorted((left, right) => left.key.localeCompare(right.key)))
    .toSorted((left, right) => (left[0]?.key ?? "").localeCompare(right[0]?.key ?? ""))
    .map(group => {
      const [one] = group;
      const keys = group.map(entry => `"${entry.key}"`).join(", ");
      const bundles = [...new Set(group.map(entry => entry.bundle))].map(name => `"${name}"`);
      const size = one === undefined ? "" : `${one.width}×${one.height}`;
      const mb = one === undefined ? 0 : textureMb(one.width, one.height);

      return (
        `the same picture (${size}, ${mb} MB a copy) is packed under ${group.length} keys: ` +
        `${keys}, in ${bundles.length === 1 ? "bundle" : "bundles"} ${bundles.join(", ")}.`
      );
    });
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
  const sources = await readTextures(run, bundle);
  const plan = planGroups(sources);

  for (const { key, sha, width, height } of sources) {
    run.twins.set(sha, [...(run.twins.get(sha) ?? []), { key, bundle: name, width, height }]);
  }

  // The atlas groups first, then what stays a file of its own: what the plan kept out of a group.
  const packed = await packGroups(run, name, plan.groups);
  const files = [...packed.files, ...(await packLoose(run, name, plan.loose, bundle.files))];

  // A texture on a page costs nothing of its own: the bundle pays for its pages instead.
  const mb = sumMb([...packed.pages, ...files.filter(file => file.atlas === undefined)]);

  return {
    feature: bundle.feature,
    ...(bundle.parent === undefined ? {} : { parent: bundle.parent }),
    ...(bundle.dir === undefined ? {} : { dir: bundle.dir }),
    tier: bundle.tier,
    ...(bundle.release === undefined ? {} : { release: bundle.release }),
    mb,
    ...(packed.pages.length === 0
      ? {}
      : { pages: packed.pages.toSorted((left, right) => left.id.localeCompare(right.id)) }),
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

  if (file.mips === true) {
    return [
      `the texture "${file.key}" has mipmaps, so it must stay loose, but lies on page "${atlas.page}".`
    ];
  }

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

  problems.push(...checkOriginal(file, atlas, source));

  return problems;
}

/**
 * Checks the original image of a packed texture (F198): its size is the size of its source, a
 * trimmed frame lies inside it, and a nine-slice is not trimmed.
 *
 * @param file - One packed texture.
 * @param atlas - Its frame.
 * @param source - The same texture in the scan.
 * @returns The problems, empty when the original is right.
 */
function checkOriginal(
  file: ManifestFile,
  atlas: AtlasFrame,
  source: ManifestFile | undefined
): string[] {
  const problems: string[] = [];
  const trim = trimOf(atlas);
  const width = trim?.origWidth ?? atlas.width;
  const height = trim?.origHeight ?? atlas.height;
  const sameSize = width === source?.width && height === source.height;

  // The original has the size of the source, so `nine` stays valid as it is.
  if (!sameSize) {
    problems.push(
      `the frame of "${file.key}" is ${width}×${height}, its source ` +
        `${source?.width ?? 0}×${source?.height ?? 0}.`
    );
  }

  if (trim === undefined) return problems;

  const outsideOriginal =
    trim.offsetX + atlas.width > trim.origWidth || trim.offsetY + atlas.height > trim.origHeight;

  // A trimmed frame lies inside its original.
  if (outsideOriginal) {
    problems.push(
      `the frame of "${file.key}" lies outside its original (${trim.origWidth}×${trim.origHeight}).`
    );
  }

  // A nine-slice keeps its borders, so it is never trimmed.
  if (file.nine !== undefined) {
    problems.push(`the texture "${file.key}" has nine-slice borders, so it must not be trimmed.`);
  }

  return problems;
}

/**
 * Checks a packed manifest against the scan it came from: every key landed exactly once, as a
 * page frame or a file; every frame names a page of its own bundle, lies inside it and belongs to an
 * original of the size of its source (`origWidth ?? width`), so `nine` stays valid as it is; a
 * trimmed frame lies inside its original, and a texture with `nine` is never trimmed; a mipmapped
 * texture is never a frame.
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

  // Index the scan by key: the textures are checked against their sources.
  for (const bundle of Object.values(source.bundles)) {
    for (const file of bundle.files) scanned.set(file.key, file);
  }

  // Count where every key landed and check each packed texture against its page and source.
  for (const [name, entry] of Object.entries(packed.bundles)) {
    for (const file of entry.files) {
      landed.set(file.key, (landed.get(file.key) ?? 0) + 1);

      if ((file.kind ?? "texture") === "texture") {
        problems.push(...checkTexture(name, entry, file, scanned.get(file.key)));
      }
    }
  }

  // Every key of either side is in the scan and landed exactly once.
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
 * Prunes one entry of a folder: a sub-folder is pruned and removed once empty, a kept file stays,
 * any other file is deleted.
 *
 * @param folder - The folder that holds the entry.
 * @param entry - The entry as `readdir` listed it.
 * @param keep - Absolute paths of the files to keep.
 * @returns True when the entry is gone afterwards.
 */
async function pruneEntry(
  folder: string,
  entry: Dirent,
  keep: ReadonlySet<string>
): Promise<boolean> {
  const target = path.join(folder, entry.name);

  if (entry.isDirectory()) {
    if (!(await prune(target, keep))) return false;

    await rmdir(target);

    return true;
  }

  if (keep.has(target)) return false;

  await rm(target, { force: true });

  return true;
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
    if (!(await pruneEntry(folder, entry, keep))) empty = false;
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
 * Tells whether a packed file is a texture written as a file of its own, not cut out of a page.
 *
 * @param file - A file of the packed manifest.
 * @returns `true` for a loose texture.
 */
function isLooseFile(file: ManifestFile): boolean {
  return file.kind === undefined && file.path !== undefined;
}

/**
 * Counts the atlas pages of the packed bundles.
 *
 * @param bundles - The packed bundles.
 * @returns How many pages they hold together.
 */
function countPages(bundles: readonly ManifestBundle[]): number {
  return bundles.reduce((count, bundle) => count + (bundle.pages?.length ?? 0), 0);
}

/**
 * Counts the loose textures of the packed bundles.
 *
 * @param bundles - The packed bundles.
 * @returns How many textures stayed files of their own.
 */
function countLoose(bundles: readonly ManifestBundle[]): number {
  return bundles.reduce(
    (count, bundle) => count + bundle.files.filter(file => isLooseFile(file)).length,
    0
  );
}

/**
 * Packs the art of a game for production: per bundle, the textures of the `fx` group and of the
 * `main` group go onto WebP atlas pages (2048 px at most; 2 px padding and border with each frame's edge extruded 1 px
 * into it, never rotated), a texture that is not a nine-slice is cropped to its visible pixels and
 * the manifest keeps where the crop lay in the original (F198). A `main` texture above `LOOSE_SIDE`, a
 * mipmapped one and a group of one stay loose files; a texture too large for the page is a
 * problem. Fonts and sounds are copied, every file name carries the hash of its
 * bytes, and the packed manifest (version 2) names it all. Nothing is written while a problem is
 * open; afterwards the pack folder holds exactly what the manifest references, plus
 * `manifest.json`. Two runs on the same tree and the same `sharp` write the same bytes.
 *
 * @param options - The sources, the scanned manifest, the pack folder, the manifest file, the cache.
 * @returns The packed manifest and what was written.
 * @throws {Error} One error that lists every problem, when `sharp` is missing, or when the pack
 *   folder holds the sources.
 * @example
 * ```ts
 * // After `scanAssets` read the features of the game. `cache: false` skips the cache.
 * const { manifest, pages, cacheHits } = await packAssets({
 *   root: "src", manifest: scanned, cache: "node_modules/.cache/moku-game-pack",
 *   out: "dist/assets", manifestFile: "dist/assets/manifest.json"
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
    cacheHits: 0,
    twins: emptyMap()
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
    pages: countPages(all),
    loose: countLoose(all),
    bytes,
    cacheHits: run.cacheHits,
    notes: twinNotes(run.twins)
  };
}
