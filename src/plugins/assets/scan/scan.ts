/**
 * @file assets plugin, build time — the walk. Every feature owner (a folder of `features/`, and a
 * sub-feature with a door and resources of its own at any depth, found by `findFeatureOwners`), and
 * every layer the options map (a folder under the root read like one more feature), becomes the
 * manifest: one bundle per owner or layer, split by the optional `assets.ts` it exports. Node and
 * Bun only. Nothing under `src/` outside `scan/` imports it, so no game bundles it.
 */
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findFeatureOwners } from "../../../project/features";
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

/** The name of the folder of an owner the scanner reads. */
const ASSETS = "assets";

const PREFIX = "[game] assets: ";

const ESCAPE = /[.+^${}()|[\]\\]/g;

/**
 * The formats a game brings instead of an MP3 or an M4A. Only those two decode in every browser
 * and WebView; a raw ADTS `.aac` is AAC without its MP4 container, so it stays out too.
 */
const OTHER_AUDIO = /\.(?:ogg|wav|aac|opus|flac)$/i;

/** A vector font. The engine draws bitmap text, so a font arrives as a `.fnt` with its pages. */
const OTHER_FONT = /\.(?:ttf|otf|woff2?)$/i;

/** A page name that says "this folder". */
const HERE = /^\.\//;

/**
 * What one scan is told: where the features and the layers are and where the two generated files
 * go.
 *
 * @example
 * ```ts
 * // A v15 game: shared/ is a layer whose assets keep the ui.* keys.
 * const options: ScanOptions = {
 *   root: "src",
 *   manifest: "public/assets/manifest.json",
 *   keys: "src/generated/assets.ts",
 *   layers: { shared: "ui" }
 * };
 * ```
 */
export type ScanOptions = {
  /** Path of the game source root, the folder that holds the features. */
  root: string;
  /**
   * Name of the folder that holds the features: the folder whose owners `findFeatureOwners`
   * finds, at any depth. Default `"features"`.
   */
  features?: string;
  /** Path of the `manifest.json` to write. */
  manifest: string;
  /** Path of the generated key module to write. */
  keys: string;
  /** False for a check run: nothing is written. Default true. */
  write?: boolean;
  /**
   * Layers scanned next to the features: folder under `root` to the name its keys and its default
   * bundle take. `{ shared: "ui" }` reads `<root>/shared/assets.ts` and `<root>/shared/assets/`
   * exactly as `features/ui/` is read, so every key stays `ui.*`. Default `{}`: features only.
   */
  layers?: Readonly<Record<string, string>>;
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
export type Output = { file: string; text: string };

/** One bundle while it is being filled: its owner, when it loads and leaves, and its files. */
type BundleDraft = {
  feature: string;
  parent: string | undefined;
  folder: string;
  tier: Tier;
  release: "leave" | undefined;
  files: ManifestFile[];
};

/** One declared bundle that takes files out of the default bundle of its feature. */
type Split = { name: string; patterns: readonly RegExp[] };

/** The page images of every font of one feature, by the path of the `.fnt` inside `assets/`. */
type FontPages = ReadonlyMap<string, readonly string[]>;

/** One folder the walk reads as a feature or a layer. */
type Owner = {
  /** The name its keys and bundles take: the inner folder name, or the mapped name of a layer. */
  name: string;
  /** Absolute folder on disk, for reading. */
  dir: string;
  /** POSIX folder relative to the scan root; written as the bundle's `dir` for a sub-feature only. */
  folder: string;
  /** The parent feature of a sub-feature; `undefined` for a top-level feature and for a layer. */
  parent: string | undefined;
  /** What the folder brings of its own: `assets/` or `assets.ts`, and `strings/`. */
  resources: { assets: boolean; strings: boolean };
};

/** Which textures of one bundle carry mipmaps: all of them, or the ones its globs match. */
type MipRule = { all: true } | { globs: readonly { glob: string; pattern: RegExp }[] };

/** One layer of the map, and the refusal that keeps it out of the walk when it has one. */
type LayerCheck = { folder: string; name: string; refusal: string | undefined };

/** What one feature's files are read with: everything the walk decided before it started. */
type FeaturePass = {
  owner: Owner;
  assetsFolder: string;
  splits: readonly Split[];
  specs: ReadonlyMap<string, BundleSpec>;
  fonts: FontPages;
  /** Bundle name to the textures of it that carry mipmaps. */
  mips: ReadonlyMap<string, MipRule>;
  /** `"<bundle>\n<glob>"` of every mipmaps glob that matched a texture of its bundle. */
  matched: Set<string>;
};

/** Everything one scan collects. */
type ScanState = {
  root: string;
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
 * @returns The empty state.
 */
function createState(root: string): ScanState {
  return {
    root,
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
 * Reads the feature owners of the game, at any depth, in the order `findFeatureOwners` returns
 * them. A missing features folder is an empty game, not a problem. One name taken by two folders
 * is one problem of the scan, and the walk goes on with no feature owner, so the layer refusals
 * are still collected and the scan fails with every problem at once.
 *
 * @param scan - State of the scan.
 * @param features - Name of the features folder.
 * @returns The owners, each with its folder on disk.
 */
function readOwners(scan: ScanState, features: string): Owner[] {
  try {
    return findFeatureOwners(scan.root, features).map(owner => ({
      name: owner.name,
      dir: path.join(scan.root, ...owner.dir.split("/")),
      folder: owner.dir,
      parent: owner.parent,
      resources: { ...owner.resources }
    }));
  } catch (error) {
    scan.problems.push(detailOf(error));

    return [];
  }
}

/**
 * Tells whether a path is a file.
 *
 * @param file - The path to look at.
 * @returns True for a file; false for a folder or nothing.
 */
async function isFile(file: string): Promise<boolean> {
  return await stat(file).then(
    entry => entry.isFile(),
    () => false
  );
}

/**
 * Tells whether a path is a folder.
 *
 * @param dir - The path to look at.
 * @returns True for a folder; false for a file or nothing.
 */
async function isFolder(dir: string): Promise<boolean> {
  return await stat(dir).then(
    entry => entry.isDirectory(),
    () => false
  );
}

/**
 * Says why one layer cannot be read, by its own folder and name alone.
 *
 * @param folder - The layer folder under the root.
 * @param name - The name its keys and bundles take.
 * @param features - Name of the features folder.
 * @param featureNames - The feature folders found under it.
 * @returns The problem, or `undefined` when the layer is fine on its own.
 * @example
 * ```ts
 * layerRefusal("shared", "u.i", "features", []);
 * // 'the layer "shared" is mapped to "u.i", which is empty or has a "." that would fake a folder.'
 * ```
 */
function layerRefusal(
  folder: string,
  name: string,
  features: string,
  featureNames: readonly string[]
): string | undefined {
  if (folder === "" || /[/\\.]/.test(folder)) {
    return (
      `the layer "${folder}" is not a folder name: ` +
      String.raw`use a name without "/", "\" or ".".`
    );
  }

  if (folder === features) {
    return (
      `the layer "${folder}" is the features folder "${features}"; ` +
      "the features are scanned already."
    );
  }

  if (name === "" || name.includes(".")) {
    return (
      `the layer "${folder}" is mapped to "${name}", ` +
      'which is empty or has a "." that would fake a folder.'
    );
  }

  if (featureNames.includes(name)) {
    return (
      `the layer "${folder}" is mapped to "${name}", which is also a feature folder: ` +
      "their keys and bundles would merge."
    );
  }

  return undefined;
}

/**
 * Says that a layer is mapped to a name an earlier layer took.
 *
 * @param first - The folder of the earlier layer with that name, if one took it.
 * @param folder - The layer folder.
 * @param name - The name it is mapped to.
 * @returns The refusal, or `undefined` when no earlier layer took the name.
 * @example
 * ```ts
 * nameTakenRefusal("common", "shared", "ui"); // 'the layers "common" and "shared" are both mapped to "ui".'
 * ```
 */
function nameTakenRefusal(
  first: string | undefined,
  folder: string,
  name: string
): string | undefined {
  if (first === undefined) return undefined;

  return `the layers "${first}" and "${folder}" are both mapped to "${name}".`;
}

/**
 * Checks every layer of a map, sorted by folder: one refusal at most per layer, and a name that an
 * earlier layer took is a refusal of the later one.
 *
 * @param layers - Folder to name.
 * @param features - Name of the features folder.
 * @param featureNames - Every feature owner name, at any depth.
 * @returns Every layer with its refusal, in the order of the sorted folders.
 */
function checkLayers(
  layers: Readonly<Record<string, string>>,
  features: string,
  featureNames: readonly string[]
): LayerCheck[] {
  const taken = new Map<string, string>();
  const checks: LayerCheck[] = [];
  const sorted = Object.entries(layers).toSorted((left, right) => byName(left[0], right[0]));

  for (const [folder, name] of sorted) {
    // A layer is refused for its own folder and name first, then for a name taken before it.
    const refusal =
      layerRefusal(folder, name, features, featureNames) ??
      nameTakenRefusal(taken.get(name), folder, name);

    if (refusal === undefined) taken.set(name, folder);

    checks.push({ folder, name, refusal });
  }

  return checks;
}

/**
 * Lists what is wrong with a layer map before anything is read: a folder with a separator or a
 * ".", an empty side, the features folder itself, a name with a "." (it would fake a folder), a
 * name that is also a feature folder (its keys and bundles would merge in silence), two layers
 * mapped to one name.
 *
 * @param layers - Folder to name.
 * @param features - Name of the features folder.
 * @param featureNames - Every feature owner name, at any depth.
 * @returns One line per problem, in the order of the sorted folders.
 * @example
 * ```ts
 * layerProblems({ shared: "ui" }, "features", ["board", "ui"]);
 * // ['the layer "shared" is mapped to "ui", which is also a feature folder: their keys and bundles would merge.']
 * ```
 */
export function layerProblems(
  layers: Readonly<Record<string, string>>,
  features: string,
  featureNames: readonly string[]
): string[] {
  return checkLayers(layers, features, featureNames).flatMap(check =>
    check.refusal === undefined ? [] : [check.refusal]
  );
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
 * description a game writes runs as it stands. A long-lived process (the keys watch of `dev` and
 * the editor) must read a saved description again, not the module it imported first. Bun keeps a
 * module by its path and ignores a query, so the entry is dropped from its cache before each
 * import; the query (the file's size and mtime) does the same in a module runner that keys by
 * URL, such as vitest's.
 *
 * @param file - Absolute path of the description.
 * @returns Its exports, or `undefined` when the feature brought none.
 * @throws {Error} When the file exists but cannot be imported.
 */
async function importDescription(file: string): Promise<Record<string, unknown> | undefined> {
  const entry = await stat(file).catch(() => {});

  if (entry === undefined || !entry.isFile()) return undefined;

  // Bun: forget the module of the last scan; in Node the delete finds nothing and the query alone
  // counts. Not a bare `require` and not an import of `node:module`: the bundler hoists either
  // into the runtime chunk every browser chunk shares.
  // Whole microseconds in the query: Bun reads a `.` in it as a loader name.
  const { createRequire } = process.getBuiltinModule("node:module");

  delete createRequire(import.meta.url).cache[file];
  const url = `${pathToFileURL(file).href}?saved=${entry.size}-${Math.round(entry.mtimeMs * 1000)}`;

  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

/**
 * Says why the release of a declared bundle is refused: a value that is neither `"budget"` nor
 * `"leave"`, or `"leave"` on a tier that stays for the whole session.
 *
 * @param name - Name of the bundle.
 * @param tier - Its tier, already checked.
 * @param release - What the description carried as `release`.
 * @returns The problem, or `undefined` when the release is fine.
 * @example
 * ```ts
 * releaseProblem("ep01", "lazy", "later");
 * // 'the bundle "ep01" has the unknown release "later". Use budget or leave.'
 * ```
 */
function releaseProblem(name: string, tier: string, release: unknown): string | undefined {
  if (release !== undefined && release !== "budget" && release !== "leave") {
    return `the bundle "${name}" has the unknown release "${String(release)}". Use budget or leave.`;
  }

  // `boot` and `core` stay for the whole session: a bundle of them never leaves.
  if (release !== "leave" || (tier !== "boot" && tier !== "core")) return undefined;

  return (
    `the bundle "${name}" is tier "${tier}", which stays for the whole session: ` +
    'release "leave" needs scene, feature or lazy.'
  );
}

/**
 * Tells whether a `mipmaps` value is one the scanner reads: absent, `false`, `true` or a list of
 * globs. `false` and `[]` are read as absent: a JavaScript or a cast description may carry them.
 *
 * @param mipmaps - What the description carried as `mipmaps`.
 * @returns True when the value can be read.
 * @example
 * ```ts
 * isMipmapsValue("items/**"); // false: a glob needs a list
 * ```
 */
function isMipmapsValue(mipmaps: unknown): boolean {
  if (mipmaps === undefined || typeof mipmaps === "boolean") return true;

  return Array.isArray(mipmaps) && mipmaps.every(glob => typeof glob === "string");
}

/**
 * Builds the stored spec of a declared bundle: `release` only when it is `"leave"`, `mipmaps`
 * only when it is `true` or a non-empty list (copied).
 *
 * @param tier - The checked tier.
 * @param raw - The checked description of the bundle.
 * @returns The spec.
 */
function specOf(tier: Tier, raw: Record<string, unknown>): BundleSpec {
  const files = Array.isArray(raw.files) ? raw.files.map(String) : undefined;
  const mipmaps = raw.mipmaps;
  const globs = Array.isArray(mipmaps) && mipmaps.length > 0 ? mipmaps.map(String) : undefined;

  return {
    tier,
    ...(files === undefined ? {} : { files }),
    ...(raw.release === "leave" ? { release: "leave" } : {}),
    ...(mipmaps === true ? { mipmaps: true } : {}),
    ...(globs === undefined ? {} : { mipmaps: globs })
  };
}

/**
 * Reads one declared bundle into the specs of its feature: the bundle-name rule against the owner,
 * the tier, the release and the mipmaps. Each failure is one problem, and the bundle is then not
 * recorded.
 *
 * @param scan - State of the scan.
 * @param feature - Name of the feature: the inner folder name, or the mapped name of a layer.
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

  if (!isRecord(raw) || typeof tier !== "string" || !TIERS.includes(tier)) {
    scan.problems.push(
      `the bundle "${name}" has the unknown tier "${String(tier)}". ` +
        `Use one of ${TIERS.join(", ")}.`
    );

    return;
  }

  const refusal = releaseProblem(name, tier, raw.release);

  if (refusal !== undefined) {
    scan.problems.push(refusal);

    return;
  }

  if (!isMipmapsValue(raw.mipmaps)) {
    scan.problems.push(
      `the bundle "${name}" has mipmaps ${JSON.stringify(raw.mipmaps)}: ` +
        "use true or a list of globs relative to assets/."
    );

    return;
  }

  specs.set(name, specOf(tier as Tier, raw));
}

/**
 * Reads the bundles a feature or a layer declares. Every export that is a `defineBundles` result
 * counts.
 *
 * @param scan - State of the scan.
 * @param owner - The feature or layer: its folder and the name its bundles take.
 * @returns The declared bundles, empty when the owner brought no description.
 */
async function readBundleSpecs(scan: ScanState, owner: Owner): Promise<Map<string, BundleSpec>> {
  const specs = new Map<string, BundleSpec>();
  const file = path.join(owner.dir, "assets.ts");

  try {
    const loaded = await importDescription(file);

    for (const value of Object.values(loaded ?? {})) {
      if (!isRecord(value) || value.kind !== "bundles" || !isRecord(value.map)) continue;

      for (const [name, raw] of Object.entries(value.map))
        readSpec(scan, owner.name, name, raw, specs);
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
 * Builds the mipmaps rules of the declared bundles, sorted by bundle name.
 *
 * @param specs - The declared bundles of one owner.
 * @returns Bundle name to its rule, for every bundle that declares mipmaps.
 */
function mipRulesOf(specs: ReadonlyMap<string, BundleSpec>): Map<string, MipRule> {
  const rules = new Map<string, MipRule>();

  for (const [name, spec] of [...specs].toSorted((left, right) => byName(left[0], right[0]))) {
    const mipmaps = spec.mipmaps;

    if (mipmaps === true) rules.set(name, { all: true });
    else if (mipmaps !== undefined) {
      rules.set(name, { globs: mipmaps.map(glob => ({ glob, pattern: globToRegExp(glob) })) });
    }
  }

  return rules;
}

/**
 * Tells whether a texture is mipmapped by the bundle that claims it, and notes every glob of that
 * bundle it matched. A glob of one bundle never marks a file of another.
 *
 * @param pass - What this owner is read with.
 * @param bundle - The bundle that claims the texture.
 * @param relative - POSIX path of the texture inside `assets/`.
 * @returns True when the texture carries mipmaps.
 */
function wantsMips(pass: FeaturePass, bundle: string, relative: string): boolean {
  const rule = pass.mips.get(bundle);

  if (rule === undefined) return false;
  if ("all" in rule) return true;

  let wanted = false;

  for (const { glob, pattern } of rule.globs) {
    if (!pattern.test(relative)) continue;

    pass.matched.add(`${bundle}\n${glob}`);
    wanted = true;
  }

  return wanted;
}

/**
 * Notes every mipmaps glob of an owner that matched no texture of its bundle: a typo would
 * otherwise leave the art without its chain in silence.
 *
 * @param scan - State of the scan.
 * @param pass - What the owner was read with, after its files.
 */
function noteUnmatchedGlobs(scan: ScanState, pass: FeaturePass): void {
  for (const [bundle, rule] of pass.mips) {
    if ("all" in rule) continue;

    for (const { glob } of rule.globs) {
      if (pass.matched.has(`${bundle}\n${glob}`)) continue;

      scan.notes.push(
        `the mipmaps glob "${glob}" of the bundle "${bundle}" matches no texture of it.`
      );
    }
  }
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
 * Finds or starts the draft of one bundle: its owner, and the tier and release its spec declares
 * (the tier `feature` and no release without one).
 *
 * @param scan - State of the scan.
 * @param name - Name of the bundle.
 * @param owner - The feature or layer that owns it.
 * @param spec - What the owner's `assets.ts` declared for it, if anything.
 * @returns The draft.
 */
function draftOf(
  scan: ScanState,
  name: string,
  owner: Owner,
  spec: BundleSpec | undefined
): BundleDraft {
  const found = scan.drafts.get(name);

  if (found !== undefined) return found;

  const draft: BundleDraft = {
    feature: owner.name,
    parent: owner.parent,
    folder: owner.folder,
    tier: spec?.tier ?? "feature",
    release: spec?.release === "leave" ? "leave" : undefined,
    files: []
  };

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
 * // 'ignored "features/ui/assets/click.wav": audio is .mp3 or .m4a only.'
 * ```
 */
function ignoredNote(file: string): string {
  if (OTHER_AUDIO.test(file)) return `ignored "${file}": audio is .mp3 or .m4a only.`;
  if (OTHER_FONT.test(file)) return `ignored "${file}": a font is a .fnt file with its .png pages.`;

  return `ignored "${file}": the scanner reads .png, .webp, .fnt, .mp3 and .m4a only.`;
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
 * Reads one asset file into a manifest entry: a texture by its pixels (every level of its chain
 * when it carries mipmaps), a font with its pages, an audio file by its bytes.
 *
 * @param scan - State of the scan.
 * @param pass - What this feature is read with.
 * @param relative - POSIX path of the file inside `assets/`.
 * @param bundle - The bundle that claims the file, whose mipmaps rule a texture follows.
 * @returns The entry.
 * @throws {Error} When the key, the tags, the header bytes or the nine-slice are wrong.
 */
async function describeFile(
  scan: ScanState,
  pass: FeaturePass,
  relative: string,
  bundle: string
): Promise<ManifestFile> {
  const absolute = path.join(pass.assetsFolder, ...relative.split("/"));
  const file = toPosix(path.relative(scan.root, absolute));
  const fileName = relative.slice(relative.lastIndexOf("/") + 1);
  const key = keyOf(pass.owner.name, relative, file);
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

  const mips = wantsMips(pass, bundle, relative);

  return {
    key,
    path: file,
    width: size.width,
    height: size.height,
    mb: textureMb(size.width, size.height, mips),
    ...(mips ? { mips: true } : {}),
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
    const name = ownerOf(pass.splits, relative, file) ?? pass.owner.name;
    const entry = await describeFile(scan, pass, relative, name);

    draftOf(scan, name, pass.owner, pass.specs.get(name)).files.push(entry);
  } catch (error) {
    scan.problems.push(detailOf(error));
  }
}

/**
 * Reads one feature or layer: its description first, then its fonts, then every file of its
 * `assets/` (never a child owner's), then the notes of its unmatched mipmaps globs. A sub-feature
 * with resources has its default bundle even with no file, so its lazy strings travel with it.
 *
 * @param scan - State of the scan.
 * @param owner - The feature or layer: its folders and the name its keys and bundles take.
 */
async function scanOwner(scan: ScanState, owner: Owner): Promise<void> {
  // The description first: the bundles it declares, with their tiers.
  const specs = await readBundleSpecs(scan, owner);
  const assetsFolder = path.join(owner.dir, ASSETS);

  for (const [name, spec] of specs) draftOf(scan, name, owner, spec);

  if (owner.parent !== undefined && (owner.resources.assets || owner.resources.strings)) {
    draftOf(scan, owner.name, owner, specs.get(owner.name));
  }

  // Then the fonts: their page images belong to them.
  const files = await walkAssets(assetsFolder, "");
  const fonts = await readFonts(scan, assetsFolder, files);
  const pages = new Set([...fonts.values()].flat());
  const pass: FeaturePass = {
    owner,
    assetsFolder,
    splits: splitsOf(specs),
    specs,
    fonts,
    mips: mipRulesOf(specs),
    matched: new Set()
  };

  // Then every other file, into the bundle that claims it.
  for (const relative of files) {
    // A page image is part of its font: it is neither a key nor a note.
    if (pages.has(relative)) continue;

    await addFile(scan, pass, relative);
  }

  noteUnmatchedGlobs(scan, pass);
}

/**
 * Tells whether a folder brings assets of its own: an `assets/` folder or an `assets.ts` file.
 *
 * @param dir - The folder on disk.
 * @returns True when it has either.
 */
async function hasAssets(dir: string): Promise<boolean> {
  return (await isFolder(path.join(dir, ASSETS))) || (await isFile(path.join(dir, "assets.ts")));
}

/**
 * Notes every near miss: a direct child folder of a feature owner that has assets but is no owner
 * itself (it has no door), so none of its files are in the manifest. Notes never stop a build.
 *
 * @param scan - State of the scan.
 * @param owners - The feature owners, in walk order.
 */
async function noteStrayFolders(scan: ScanState, owners: readonly Owner[]): Promise<void> {
  const folders = new Set(owners.map(owner => owner.folder));

  for (const owner of owners) {
    const entries = await readdir(owner.dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries.toSorted((left, right) => byName(left.name, right.name))) {
      const folder = `${owner.folder}/${entry.name}`;

      if (!entry.isDirectory() || entry.name === ASSETS || folders.has(folder)) continue;
      if (!(await hasAssets(path.join(owner.dir, entry.name)))) continue;

      scan.notes.push(
        `the folder "${folder}" has assets but is no feature: its files are not in the manifest. ` +
          "A sub-feature needs a door index.ts."
      );
    }
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

    // Only a sub-feature's bundle carries its parent and its folder: a flat manifest keeps its bytes.
    bundles[name] = {
      feature: draft.feature,
      ...(draft.parent === undefined ? {} : { parent: draft.parent, dir: draft.folder }),
      tier: draft.tier,
      ...(draft.release === undefined ? {} : { release: draft.release }),
      mb: sumMb(files),
      files
    };
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
 * Writes the outputs whose text changed, and tells whether any of them differed. The pack run of
 * the CLI writes the key module through it, so the keys get the same bytes in both modes.
 *
 * @param outputs - Where each output goes and what it should contain.
 * @param write - False for a check run: nothing is written.
 * @returns True when an output on disk differs from what the scan produced.
 * @example
 * ```ts
 * await applyOutputs([{ file: "src/generated/assets.ts", text: keysSource }], true);
 * // true when the file was missing or held other text, and it holds keysSource now
 * ```
 */
export async function applyOutputs(outputs: readonly Output[], write: boolean): Promise<boolean> {
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
 * Reads the layers that passed their checks, sorted by folder. A layer without its folder is a
 * note, not a problem: a typo in `--layer` would otherwise drop its keys without a word.
 *
 * @param scan - State of the scan.
 * @param checks - Every layer with its refusal; a refused layer is not read.
 */
async function scanLayers(scan: ScanState, checks: readonly LayerCheck[]): Promise<void> {
  for (const { folder, name, refusal } of checks) {
    if (refusal !== undefined) continue;

    const dir = path.join(scan.root, folder);

    if (!(await isFolder(dir))) {
      scan.notes.push(
        `the layer "${folder}" has no folder "${folder}/" under the root; nothing was read for it.`
      );
      continue;
    }

    // A layer is read for its `assets/` and `assets.ts` only, and is never a sub-feature.
    await scanOwner(scan, {
      name,
      dir,
      folder,
      parent: undefined,
      resources: { assets: true, strings: false }
    });
  }
}

/**
 * Walks the features and the layers of a game and writes its two generated files: one bundle per
 * feature owner or layer, split by its optional `assets.ts`, every file keyed by the key rule. A
 * sub-feature (a folder with a door and resources inside a feature, at any depth) is an owner of
 * its own: its keys and its bundle take the inner folder name, and only its bundle carries
 * `parent` and `dir`. A layer is read like one more feature under its mapped name, after the
 * features. A check run (`write: false`) writes nothing and only reports whether something would
 * change.
 *
 * @param options - The game source root, the layers, the two output paths and whether to write.
 * @returns The manifest, the text of the key module and whether an output differed.
 * @throws {Error} One error that lists every problem the scan found, the owner and layer problems
 *   first.
 * @example
 * ```ts
 * const { manifest, changed } = await scanAssets({
 *   root: "src",
 *   manifest: "public/assets/manifest.json",
 *   keys: "src/generated/assets.ts",
 *   layers: { shared: "ui" } // shared/assets/button/primary.png keeps the key "ui.button.primary"
 * });
 * // manifest.bundles.ui.files[0].key: "ui.button.primary", changed: true on the first run
 * // features/episodes/ep01/assets/ward/room.png keeps the key "ep01.ward.room" in the bundle "ep01"
 * ```
 */
export async function scanAssets(options: ScanOptions): Promise<ScanResult> {
  // The layers are checked against every feature owner before anything is read.
  const features = options.features ?? "features";
  const scan = createState(options.root);
  const owners = readOwners(scan, features);
  const checks = checkLayers(
    options.layers ?? {},
    features,
    owners.map(owner => owner.name)
  );

  for (const check of checks) {
    if (check.refusal !== undefined) scan.problems.push(check.refusal);
  }

  // The feature owners first, then every layer that passed, each like one more feature.
  for (const owner of owners) await scanOwner(scan, owner);

  await noteStrayFolders(scan, owners);
  await scanLayers(scan, checks);

  // Every problem in one error: nothing is written while there is one.
  if (scan.problems.length > 0) throw collected(scan.problems);

  // The manifest and the key module: written when their text changed, never by a check run.
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
