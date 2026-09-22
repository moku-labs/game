/**
 * @file assets plugin, build time — the walk. `features/*` with an `assets/` folder becomes the
 * manifest: one bundle per feature, split by the optional `assets.ts` that feature exports.
 * Node and Bun only. Nothing under `src/` outside `scan/` imports it, so no game bundles it.
 */
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BundleSpec,
  FontPage,
  Manifest,
  ManifestBundle,
  ManifestFile,
  NineSlice,
  Tier
} from "../types";
import { emitKeys, emitManifest } from "./emit";
import { pagesOfFont } from "./fonts";
import { bytesMb, HEADER_BYTES, type ImageSize, readImageSize, textureMb } from "./image-size";
import { assetKindOf, isAssetFile, keyOf, parseTags } from "./keys";

const TIERS: readonly string[] = ["boot", "core", "scene", "feature", "lazy"];

const PREFIX = "[game] assets: ";

const ESCAPE = /[.+^${}()|[\]\\]/g;

/** The formats a game brings instead of an MP3. One format decodes everywhere, so MP3 it is. */
const OTHER_AUDIO = /\.(?:ogg|wav|m4a|aac|opus|flac)$/i;

/** A vector font. The engine draws bitmap text, so a font arrives as a `.fnt` with its pages. */
const OTHER_FONT = /\.(?:ttf|otf|woff2?)$/i;

/** A page name that says "this folder". */
const HERE = /^\.\//;

/**
 * What one scan is told: where the features are and where the two generated files go.
 */
export type ScanOptions = {
  /** Path of the game source root, the folder that holds the features. */
  root: string;
  /** Name of the folder that holds the features. Default `"features"`. */
  features?: string;
  /** Path of the `manifest.json` to write. */
  manifest: string;
  /** Path of the generated key module to write. */
  keys: string;
  /** False for a check run: nothing is written. Default true. */
  write?: boolean;
};

/**
 * What a scan produced.
 */
export type ScanResult = {
  /** The manifest, with bundles sorted by name and files sorted by key. */
  manifest: Manifest;
  /** The text of the generated key module. */
  keysSource: string;
  /** True when an output on disk differs from what the scan produced. */
  changed: boolean;
  /** One line per file the scan left out. Nothing here stops a build. */
  notes: readonly string[];
};

/** One output file: where it goes and what it should contain. */
type Output = { file: string; text: string };

/** One bundle while it is being filled. */
type BundleDraft = { feature: string; tier: Tier; files: ManifestFile[] };

/** One declared bundle that takes files out of the default bundle of its feature. */
type Split = { name: string; patterns: readonly RegExp[] };

/** The page images of every font of one feature, by the path of the `.fnt` inside `assets/`. */
type FontPages = ReadonlyMap<string, readonly string[]>;

/** What one feature's files are read with: everything the walk decided before it started. */
type FeaturePass = {
  feature: string;
  assetsFolder: string;
  splits: readonly Split[];
  defaultTier: Tier;
  fonts: FontPages;
};

/** Everything one scan collects. */
type ScanState = {
  root: string;
  featuresFolder: string;
  drafts: Map<string, BundleDraft>;
  keyOwner: Map<string, string>;
  problems: string[];
  notes: string[];
};

/**
 * Wraps a scanner problem in the message shape of the framework.
 *
 * @param message - One sentence naming the file or the bundle.
 * @returns The error to throw.
 */
function problem(message: string): Error {
  return new Error(`${PREFIX}${message}`);
}

/**
 * Reads the message of anything that was thrown.
 *
 * @param failure - What the `catch` caught.
 * @returns The message, without the framework prefix.
 */
function detailOf(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure);

  return message.startsWith(PREFIX) ? message.slice(PREFIX.length) : message;
}

/**
 * Creates the state of one scan. It is its own function because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @param root - Absolute or relative path of the game source root.
 * @param features - Name of the features folder.
 * @returns The empty state.
 */
function createState(root: string, features: string): ScanState {
  return {
    root,
    featuresFolder: path.join(root, features),
    drafts: new Map(),
    keyOwner: new Map(),
    problems: [],
    notes: []
  };
}

/**
 * Turns a path of this machine into the POSIX path the manifest carries.
 *
 * @param value - A path as `node:path` built it.
 * @returns The same path with forward slashes.
 */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Compares two names, so every list the scanner writes has one order.
 *
 * @param left - First name.
 * @param right - Second name.
 * @returns The sort order.
 */
function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
 * Lists the feature folders, sorted. A missing features folder is an empty game, not a problem.
 *
 * @param dir - The features folder.
 * @returns The folder names.
 */
async function listFeatures(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .toSorted(byName);
}

/**
 * Walks one `assets/` folder.
 *
 * @param dir - The folder to read.
 * @param prefix - POSIX path of that folder inside `assets/`.
 * @returns The POSIX paths of every file below it, sorted.
 */
async function walkAssets(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries.toSorted((left, right) => byName(left.name, right.name))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    if (entry.isDirectory())
      files.push(...(await walkAssets(path.join(dir, entry.name), relative)));
    else files.push(relative);
  }

  return files;
}

/**
 * Reads the first bytes of a file, which is all the size needs.
 *
 * @param file - Absolute path of the file.
 * @returns The header bytes, fewer when the file is shorter.
 */
async function readHead(file: string): Promise<Uint8Array> {
  const handle = await open(file, "r");

  try {
    const head = new Uint8Array(HEADER_BYTES);
    const { bytesRead } = await handle.read(head, 0, HEADER_BYTES, 0);

    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Tells whether a value is a plain object.
 *
 * @param value - Anything a description exported.
 * @returns True for an object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Imports the optional `assets.ts` of a feature. Node strips the types of a `.ts` file, so the
 * description a game writes runs as it stands.
 *
 * @param file - Absolute path of the description.
 * @returns Its exports, or `undefined` when the feature brought none.
 * @throws {Error} When the file exists but cannot be imported.
 */
async function importDescription(file: string): Promise<Record<string, unknown> | undefined> {
  const exists = await stat(file).then(
    entry => entry.isFile(),
    () => false
  );

  if (!exists) return undefined;

  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

/**
 * Reads one declared bundle into the specs of its feature.
 *
 * @param scan - State of the scan.
 * @param feature - Name of the feature.
 * @param name - Name of the bundle.
 * @param raw - What the description carried under that name.
 * @param specs - Where a valid bundle goes.
 */
function readSpec(
  scan: ScanState,
  feature: string,
  name: string,
  raw: unknown,
  specs: Map<string, BundleSpec>
): void {
  if (name !== feature && !name.startsWith(`${feature}.`)) {
    scan.problems.push(
      `the feature "${feature}" declares the bundle "${name}", which is neither "${feature}" ` +
        `nor a name starting with "${feature}.".`
    );

    return;
  }

  const tier = isRecord(raw) ? raw.tier : undefined;

  if (typeof tier !== "string" || !TIERS.includes(tier)) {
    scan.problems.push(
      `the bundle "${name}" has the unknown tier "${String(tier)}". ` +
        `Use one of ${TIERS.join(", ")}.`
    );

    return;
  }

  const files = isRecord(raw) && Array.isArray(raw.files) ? raw.files.map(String) : undefined;

  specs.set(name, files === undefined ? { tier: tier as Tier } : { tier: tier as Tier, files });
}

/**
 * Reads the bundles a feature declares. Every export that is a `defineBundles` result counts.
 *
 * @param scan - State of the scan.
 * @param feature - Name of the feature.
 * @returns The declared bundles, empty when the feature brought no description.
 */
async function readBundleSpecs(scan: ScanState, feature: string): Promise<Map<string, BundleSpec>> {
  const specs = new Map<string, BundleSpec>();
  const file = path.join(scan.featuresFolder, feature, "assets.ts");

  try {
    const loaded = await importDescription(file);

    for (const value of Object.values(loaded ?? {})) {
      if (!isRecord(value) || value.kind !== "bundles" || !isRecord(value.map)) continue;

      for (const [name, raw] of Object.entries(value.map))
        readSpec(scan, feature, name, raw, specs);
    }
  } catch (error) {
    const relative = toPosix(path.relative(scan.root, file));

    scan.problems.push(`the description "${relative}" could not be read: ${detailOf(error)}`);
  }

  return specs;
}

/**
 * Turns one glob of a declared bundle into a matcher. `**` crosses folders, `*` and `?` do not.
 *
 * @param glob - The glob, relative to the feature's `assets/`.
 * @returns The matcher.
 */
function globToRegExp(glob: string): RegExp {
  const parts: string[] = [];
  let index = 0;

  while (index < glob.length) {
    const rest = glob.slice(index);

    if (rest.startsWith("**/")) {
      parts.push("(?:.*/)?");
      index += 3;
    } else if (rest.startsWith("**")) {
      parts.push(".*");
      index += 2;
    } else if (rest.startsWith("*")) {
      parts.push("[^/]*");
      index += 1;
    } else if (rest.startsWith("?")) {
      parts.push("[^/]");
      index += 1;
    } else {
      parts.push(rest.slice(0, 1).replaceAll(ESCAPE, String.raw`\$&`));
      index += 1;
    }
  }

  return new RegExp(`^${parts.join("")}$`);
}

/**
 * Builds the matchers of the declared bundles that take files out of the default bundle.
 *
 * @param specs - The declared bundles of one feature.
 * @returns The splits, sorted by bundle name.
 */
function splitsOf(specs: Map<string, BundleSpec>): Split[] {
  const splits: Split[] = [];

  for (const [name, spec] of [...specs].toSorted((left, right) => byName(left[0], right[0]))) {
    if (spec.files === undefined || spec.files.length === 0) continue;

    splits.push({ name, patterns: spec.files.map(glob => globToRegExp(glob)) });
  }

  return splits;
}

/**
 * Works out which declared bundle claims a file.
 *
 * @param splits - The splits of the feature.
 * @param relative - POSIX path of the file inside `assets/`.
 * @param file - Path of the file from the scan root, for the message.
 * @returns The bundle name, or `undefined` when the file stays in the default bundle.
 * @throws {Error} When two bundles claim the same file.
 */
function ownerOf(splits: readonly Split[], relative: string, file: string): string | undefined {
  const matched = splits
    .filter(split => split.patterns.some(pattern => pattern.test(relative)))
    .map(split => split.name);

  if (matched.length > 1) {
    const [first, second] = matched;

    throw problem(
      `file "${file}" is claimed by the bundles "${String(first)}" and "${String(second)}".`
    );
  }

  return matched[0];
}

/**
 * Refuses nine-slice borders that leave no centre: left and right together, and top and bottom
 * together, must stay below the sides of the image.
 *
 * @param nine - The borders of the file, when it carries a tag.
 * @param size - The pixel size of the file.
 * @param file - Path of the file, for the message.
 * @throws {Error} When the borders of one axis reach its side.
 */
function checkNine(nine: NineSlice | undefined, size: ImageSize, file: string): void {
  if (nine === undefined) return;

  const { left, top, right, bottom } = nine;
  const hasCentre = left + right < size.width && top + bottom < size.height;

  if (hasCentre) return;

  const isUniform = left === top && top === right && right === bottom;
  const rule = isUniform
    ? `${left} of "${file}" must be smaller than half of`
    : `${left},${top},${right},${bottom} of "${file}" must leave a centre inside`;

  throw problem(`the nine-slice ${rule} ${size.width}×${size.height}.`);
}

/**
 * Finds or starts the draft of one bundle.
 *
 * @param scan - State of the scan.
 * @param name - Name of the bundle.
 * @param feature - Feature that owns it.
 * @param tier - When it loads.
 * @returns The draft.
 */
function draftOf(scan: ScanState, name: string, feature: string, tier: Tier): BundleDraft {
  const found = scan.drafts.get(name);

  if (found !== undefined) return found;

  const draft: BundleDraft = { feature, tier, files: [] };

  scan.drafts.set(name, draft);

  return draft;
}

/**
 * Says in one line why a file of an `assets/` folder is not in the manifest. Nothing here stops
 * a build: the note is read once, when the file was meant to be an asset.
 *
 * @param file - Path of the file from the scan root.
 * @returns The note.
 * @example
 * ```ts
 * ignoredNote("features/ui/assets/click.wav");
 * // 'ignored "features/ui/assets/click.wav": audio is .mp3 only.'
 * ```
 */
function ignoredNote(file: string): string {
  if (OTHER_AUDIO.test(file)) return `ignored "${file}": audio is .mp3 only.`;
  if (OTHER_FONT.test(file)) return `ignored "${file}": a font is a .fnt file with its .png pages.`;

  return `ignored "${file}": the scanner reads .png, .webp, .fnt and .mp3 only.`;
}

/**
 * Works out where a page of a font lives: page names are relative to the `.fnt` file.
 *
 * @param font - POSIX path of the `.fnt` file inside `assets/`.
 * @param page - The page name the font declared.
 * @returns The POSIX path of the page inside `assets/`.
 * @example
 * ```ts
 * resolvePage("fonts/body.fnt", "body_0.png"); // "fonts/body_0.png"
 * ```
 */
function resolvePage(font: string, page: string): string {
  const cut = font.lastIndexOf("/");

  return `${cut === -1 ? "" : font.slice(0, cut + 1)}${page.replace(HERE, "")}`;
}

/**
 * Reads every `.fnt` of a feature before its files are described: a page image belongs to its
 * font and never becomes an asset key of its own, so the walk has to know the pages first.
 *
 * @param scan - State of the scan.
 * @param assetsFolder - Absolute path of the feature's `assets/`.
 * @param files - Every file of that folder, as POSIX paths inside it.
 * @returns The pages of each font, in declaration order.
 */
async function readFonts(
  scan: ScanState,
  assetsFolder: string,
  files: readonly string[]
): Promise<FontPages> {
  const fonts = new Map<string, readonly string[]>();
  const known = new Set(files);

  for (const relative of files) {
    if (assetKindOf(relative) !== "font") continue;

    const absolute = path.join(assetsFolder, ...relative.split("/"));
    const file = toPosix(path.relative(scan.root, absolute));

    try {
      const pages: string[] = [];

      for (const declared of pagesOfFont(await readFile(absolute, "utf8"), file)) {
        const page = resolvePage(relative, declared);

        if (known.has(page)) pages.push(page);
        else {
          scan.problems.push(
            `the font "${file}" names the page "${declared}", which is not next to it.`
          );
        }
      }

      fonts.set(relative, pages);
    } catch (error) {
      scan.problems.push(detailOf(error));
    }
  }

  return fonts;
}

/**
 * Reads the pages of one font into manifest entries. The pages carry no key: they are listed
 * under the `.fnt` file and loaded with it.
 *
 * @param scan - State of the scan.
 * @param pass - What this feature is read with.
 * @param relative - POSIX path of the `.fnt` file inside `assets/`.
 * @returns The pages, in the order the font declares them.
 * @throws {Error} When a page is not a PNG or a WebP the scanner reads.
 */
async function describePages(
  scan: ScanState,
  pass: FeaturePass,
  relative: string
): Promise<FontPage[]> {
  const pages: FontPage[] = [];

  for (const page of pass.fonts.get(relative) ?? []) {
    const absolute = path.join(pass.assetsFolder, ...page.split("/"));
    const file = toPosix(path.relative(scan.root, absolute));
    const size = readImageSize(await readHead(absolute), file);

    pages.push({
      path: file,
      width: size.width,
      height: size.height,
      mb: textureMb(size.width, size.height)
    });
  }

  return pages;
}

/**
 * Reads one asset file into a manifest entry: a texture by its pixels, a font with its pages, an
 * audio file by its bytes.
 *
 * @param scan - State of the scan.
 * @param pass - What this feature is read with.
 * @param relative - POSIX path of the file inside `assets/`.
 * @returns The entry.
 * @throws {Error} When the key, the tags, the header bytes or the nine-slice are wrong.
 */
async function describeFile(
  scan: ScanState,
  pass: FeaturePass,
  relative: string
): Promise<ManifestFile> {
  const absolute = path.join(pass.assetsFolder, ...relative.split("/"));
  const file = toPosix(path.relative(scan.root, absolute));
  const fileName = relative.slice(relative.lastIndexOf("/") + 1);
  const key = keyOf(pass.feature, relative, file);
  const owner = scan.keyOwner.get(key);

  if (owner !== undefined) {
    throw problem(`key "${key}" comes from two files: ${owner} and ${file}.`);
  }

  const kind = assetKindOf(fileName);
  const { nine, note } = parseTags(fileName, file);

  if (note !== undefined) scan.notes.push(note);

  if (kind === "font") {
    const pages = await describePages(scan, pass, relative);

    scan.keyOwner.set(key, file);

    return { key, path: file, kind, width: 0, height: 0, mb: sumMb(pages), pages };
  }

  if (kind === "audio") {
    const { size } = await stat(absolute);

    scan.keyOwner.set(key, file);

    return { key, path: file, kind, width: 0, height: 0, mb: bytesMb(size) };
  }

  const size = readImageSize(await readHead(absolute), file);

  checkNine(nine, size, file);
  // The key is taken only by a file that passed its checks, so a broken image never owns one.
  scan.keyOwner.set(key, file);

  return {
    key,
    path: file,
    width: size.width,
    height: size.height,
    mb: textureMb(size.width, size.height),
    ...(nine === undefined ? {} : { nine })
  };
}

/**
 * Reads one file of a feature into the bundle that claims it.
 *
 * @param scan - State of the scan.
 * @param pass - What this feature is read with.
 * @param relative - POSIX path of the file inside `assets/`.
 */
async function addFile(scan: ScanState, pass: FeaturePass, relative: string): Promise<void> {
  const absolute = path.join(pass.assetsFolder, ...relative.split("/"));
  const file = toPosix(path.relative(scan.root, absolute));

  if (!isAssetFile(relative)) {
    scan.notes.push(ignoredNote(file));

    return;
  }

  try {
    const name = ownerOf(pass.splits, relative, file) ?? pass.feature;
    const entry = await describeFile(scan, pass, relative);

    draftOf(scan, name, pass.feature, pass.defaultTier).files.push(entry);
  } catch (error) {
    scan.problems.push(detailOf(error));
  }
}

/**
 * Reads one feature: its description first, then its fonts, then every file of its `assets/`.
 *
 * @param scan - State of the scan.
 * @param feature - Name of the feature folder.
 */
async function scanFeature(scan: ScanState, feature: string): Promise<void> {
  const specs = await readBundleSpecs(scan, feature);
  const assetsFolder = path.join(scan.featuresFolder, feature, "assets");

  for (const [name, spec] of specs) draftOf(scan, name, feature, spec.tier);

  const files = await walkAssets(assetsFolder, "");
  const fonts = await readFonts(scan, assetsFolder, files);
  const pages = new Set([...fonts.values()].flat());
  const pass: FeaturePass = {
    feature,
    assetsFolder,
    splits: splitsOf(specs),
    defaultTier: specs.get(feature)?.tier ?? "feature",
    fonts
  };

  for (const relative of files) {
    // A page image is part of its font: it is neither a key nor a note.
    if (pages.has(relative)) continue;

    await addFile(scan, pass, relative);
  }
}

/**
 * Adds up what a list of files costs: the files of a bundle, or the pages of a font.
 *
 * @param files - Anything that carries an `mb`.
 * @returns The sum in MB, rounded to three decimals.
 */
function sumMb(files: readonly { mb: number }[]): number {
  let total = 0;

  for (const file of files) total += file.mb;

  return Math.round(total * 1000) / 1000;
}

/**
 * Turns the drafts into the manifest, sorted for byte-identical output.
 *
 * @param scan - State of the scan.
 * @returns The manifest.
 */
function toManifest(scan: ScanState): Manifest {
  const bundles: Record<string, ManifestBundle> = {};

  for (const [name, draft] of [...scan.drafts].toSorted((left, right) =>
    byName(left[0], right[0])
  )) {
    const files = draft.files.toSorted((left, right) => byName(left.key, right.key));

    bundles[name] = { feature: draft.feature, tier: draft.tier, mb: sumMb(files), files };
  }

  return { version: 1, bundles };
}

/**
 * Collects every problem of a scan into one error, so a game fixes its assets in one round.
 *
 * @param problems - The problems, in scan order.
 * @returns The error to reject with.
 */
function collected(problems: readonly string[]): Error {
  const count = problems.length;
  const lines = problems.map(text => `  ${text}`).join("\n");

  return new Error(
    `${PREFIX}the scan found ${count} problem${count === 1 ? "" : "s"}.\n${lines}\n` +
      '  Fix them and run "bun run assets:keys" again.'
  );
}

/**
 * Reads an output file that may not exist yet.
 *
 * @param file - Path of the file.
 * @returns Its text, or `undefined` when it is not there.
 */
async function readCurrent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Writes the outputs whose text changed, and tells whether any of them differed.
 *
 * @param outputs - Where each output goes and what it should contain.
 * @param write - False for a check run: nothing is written.
 * @returns True when an output on disk differs from what the scan produced.
 */
async function applyOutputs(outputs: readonly Output[], write: boolean): Promise<boolean> {
  let changed = false;

  for (const output of outputs) {
    if ((await readCurrent(output.file)) === output.text) continue;

    changed = true;

    if (!write) continue;

    await mkdir(path.dirname(output.file), { recursive: true });
    await writeFile(output.file, output.text);
  }

  return changed;
}

/**
 * Walks the features of a game and writes its two generated files: one bundle per feature, split
 * by the optional `assets.ts` of that feature, every file keyed by the key rule. A check run
 * (`write: false`) writes nothing and only reports whether something would change.
 *
 * @param options - The game source root, the two output paths and whether to write.
 * @returns The manifest, the text of the key module and whether an output differed.
 * @throws {Error} One error that lists every problem the scan found.
 * @example
 * ```ts
 * const { manifest, changed } = await scanAssets({
 *   root: "src",
 *   manifest: "public/assets/manifest.json",
 *   keys: "src/generated/assets.ts"
 * });
 * // manifest.bundles.ui.files[0].key: "ui.button.primary", changed: true on the first run
 * ```
 */
export async function scanAssets(options: ScanOptions): Promise<ScanResult> {
  const scan = createState(options.root, options.features ?? "features");

  for (const feature of await listFeatures(scan.featuresFolder)) await scanFeature(scan, feature);

  if (scan.problems.length > 0) throw collected(scan.problems);

  const manifest = toManifest(scan);
  const manifestSource = emitManifest(manifest);
  const keysSource = emitKeys(manifest);
  const changed = await applyOutputs(
    [
      { file: options.manifest, text: manifestSource },
      { file: options.keys, text: keysSource }
    ],
    options.write !== false
  );

  return { manifest, keysSource, changed, notes: scan.notes };
}
