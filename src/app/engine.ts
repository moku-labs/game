/**
 * @file app — the engine a page is served or built with: its version, a hash of its bundled dist and of any declared
 * patch. Imports `node:fs`, `node:path` and `node:crypto` only, nothing from a plugin. The dev page, the editor's
 * `preparePage` and a debug build write its id into the page as `globalThis.__MOKU_GAME_ENGINE__`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The package name of the engine. */
const ENGINE_PACKAGE = "@moku-labs/game";

/** The lock files that mark the install root, where the patch walk stops. */
const LOCK_FILES = ["bun.lock", "bun.lockb"] as const;

/** The fields of a `package.json` the fingerprint reads, each unchecked. */
type PackageFields = { name?: unknown; version?: unknown; patchedDependencies?: unknown };

/**
 * The engine a page is served or built with.
 *
 * @example
 * ```ts
 * const engine: EngineFingerprint = { id: "0.14.12+9c41e0", version: "0.14.12", dist: "9c41e0…", folder: "/game/node_modules/@moku-labs/game" };
 * ```
 */
export type EngineFingerprint = {
  /** What the page and the log show: "0.14.12+9c41e0", "0.14.12+9c41e0.patch.3f2a7b", "0.0.0+src", "unknown". */
  id: string;
  /** `version` of the engine's package.json, "unknown" when no package.json of `@moku-labs/game` was found. */
  version: string;
  /** SHA-256 (hex) of every file under the engine's `dist/`; "src" when the engine runs from its sources; "unknown". */
  dist: string;
  /** The patch the install root declares for this version: its file (absolute) and SHA-256 (hex). */
  patch?: { file: string; hash: string };
  /** The engine's package folder, absolute; the folder of the resolved hot plugin when "unknown". */
  folder: string;
};

/**
 * Tells whether a path is a file.
 *
 * @param file - The path.
 * @returns True for an existing file.
 */
function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * Reads the `package.json` of a folder.
 *
 * @param folder - The folder.
 * @returns Its fields, or `undefined` without a readable `package.json` object.
 */
function packageOf(folder: string): PackageFields | undefined {
  const file = path.join(folder, "package.json");

  if (!isFile(file)) return undefined;

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    // A broken package.json declares nothing.
    return undefined;
  }
}

/**
 * Tells whether a path lies inside a folder, the folder itself left out.
 *
 * @param file - The path.
 * @param folder - The folder.
 * @returns True when `file` is below `folder`.
 * @example
 * ```ts
 * isBelow("/g/dist/hot.mjs", "/g/dist"); // true
 * ```
 */
function isBelow(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Walks up from a folder to the first one whose `package.json` names the engine.
 *
 * @param start - The folder to start in.
 * @returns The engine folder and its fields, or `undefined` at the top of the disk.
 */
function engineFolderOf(start: string): { folder: string; fields: PackageFields } | undefined {
  for (let folder = start; ; folder = path.dirname(folder)) {
    const fields = packageOf(folder);

    if (fields?.name === ENGINE_PACKAGE) return { folder, fields };
    if (path.dirname(folder) === folder) return undefined;
  }
}

/**
 * Lists the files under a folder, at any depth.
 *
 * @param folder - The folder.
 * @param relative - The folder under it to list, `/` separated.
 * @returns The files, relative to `folder`, `/` separated, in no set order.
 */
function filesUnder(folder: string, relative = ""): string[] {
  return readdirSync(path.join(folder, relative), { withFileTypes: true }).flatMap(entry => {
    const inner = relative === "" ? entry.name : `${relative}/${entry.name}`;

    if (entry.isDirectory()) return filesUnder(folder, inner);

    return entry.isFile() ? [inner] : [];
  });
}

/**
 * Hashes every file under a `dist` folder: each fed as `<relative path>\0<bytes>\0`, in sorted
 * order, so a renamed file changes the hash as a changed byte does.
 *
 * @param dist - The folder.
 * @returns The SHA-256, hex.
 */
function distHash(dist: string): string {
  const hash = createHash("sha256");

  for (const file of filesUnder(dist).toSorted()) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(path.join(dist, file)));
    hash.update("\0");
  }

  return hash.digest("hex");
}

/**
 * The folders the patch walk reads, from the game up: it stops after the first folder that holds
 * `bun.lock` or `bun.lockb`, or at the top of the disk.
 *
 * @param root - The game folder.
 * @returns The folders, the game first.
 */
function foldersToInstallRoot(root: string): string[] {
  const folders: string[] = [];

  for (let folder = root; ; folder = path.dirname(folder)) {
    folders.push(folder);

    const holdsLock = LOCK_FILES.some(lock => isFile(path.join(folder, lock)));

    if (holdsLock || path.dirname(folder) === folder) return folders;
  }
}

/**
 * The patch file a `package.json` declares for one dependency key.
 *
 * @param fields - The fields of the `package.json`.
 * @param key - The key, `@moku-labs/game@<version>`.
 * @returns The declared file, relative to the folder of the `package.json`, or `undefined`.
 */
function declaredPatch(fields: PackageFields | undefined, key: string): string | undefined {
  const declared = fields?.patchedDependencies;

  if (typeof declared !== "object" || declared === null) return undefined;

  const file: unknown = Reflect.get(declared, key);

  return typeof file === "string" ? file : undefined;
}

/**
 * Finds the patch the install root declares for the installed engine version: the first
 * `package.json` on the walk whose `patchedDependencies` has the key decides.
 *
 * @param root - The game folder.
 * @param version - The installed engine version.
 * @returns The patch file and its hash; `undefined` when none is declared or the file is missing.
 */
function patchOf(root: string, version: string): EngineFingerprint["patch"] {
  const key = `${ENGINE_PACKAGE}@${version}`;

  for (const folder of foldersToInstallRoot(root)) {
    const declared = declaredPatch(packageOf(folder), key);

    if (declared === undefined) continue;

    const file = path.resolve(folder, declared);

    if (!isFile(file)) return undefined;

    return { file, hash: createHash("sha256").update(readFileSync(file)).digest("hex") };
  }

  return undefined;
}

/**
 * The install root of a game: the first folder from the game up that holds `bun.lock` or
 * `bun.lockb`, where the patch walk of `engineFingerprint` stops. The dev server watches it for an
 * engine change.
 *
 * @param root - The game folder.
 * @returns The folder, or `undefined` when no folder up to the top of the disk holds a lock file.
 * @example
 * ```ts
 * // A game in a workspace, installed at the workspace root.
 * installRootOf("/w/games/timber"); // "/w"
 * ```
 */
export function installRootOf(root: string): string | undefined {
  const last = foldersToInstallRoot(root).at(-1);

  return last !== undefined && LOCK_FILES.some(lock => isFile(path.join(last, lock)))
    ? last
    : undefined;
}

/**
 * Reads the fingerprint of the engine a game resolves: walks up from the hot plugin to the engine's package.json,
 * hashes its `dist/`, and finds the patch the install root declares for that version. A hot plugin with no engine
 * `package.json` above it (a stub path, a broken install) gives the id `"unknown"` and throws nothing.
 *
 * @param root - The game folder.
 * @param hotPlugin - The resolved path of `@moku-labs/game/hot`.
 * @returns The fingerprint.
 * @example
 * ```ts
 * engineFingerprint("/g", "/g/node_modules/@moku-labs/game/dist/hot.mjs").id; // "0.14.12+9c41e0"
 * ```
 */
export function engineFingerprint(root: string, hotPlugin: string): EngineFingerprint {
  const found = engineFolderOf(path.dirname(hotPlugin));

  if (found === undefined) {
    return { id: "unknown", version: "unknown", dist: "unknown", folder: path.dirname(hotPlugin) };
  }

  const { folder, fields } = found;
  const version = typeof fields.version === "string" ? fields.version : "unknown";
  const distFolder = path.join(folder, "dist");
  // The installed dist is what a page bundles; the engine repo resolves its sources.
  const dist = isBelow(hotPlugin, distFolder) ? distHash(distFolder) : "src";
  const patch = patchOf(root, version);
  const short = dist === "src" ? dist : dist.slice(0, 6);
  const patched = patch === undefined ? "" : `.patch.${patch.hash.slice(0, 6)}`;
  const id = `${version}+${short}${patched}`;

  return patch === undefined ? { id, version, dist, folder } : { id, version, dist, patch, folder };
}

/**
 * The one line `dev` and `build` print about the engine: its id, and the patch file relative to the game when there is one.
 *
 * @param engine - The fingerprint.
 * @param root - The game folder.
 * @returns The line.
 * @example
 * ```ts
 * engineLine({ id: "0.14.12+9c41e0.patch.3f2a7b", version: "0.14.12", dist: "9c41e0", folder: "/g/node_modules/@moku-labs/game", patch: { file: "/g/patches/@moku-labs%2Fgame@0.14.12.patch", hash: "3f2a7b" } }, "/g"); // "engine 0.14.12+9c41e0.patch.3f2a7b (patches/@moku-labs%2Fgame@0.14.12.patch)"
 * ```
 */
export function engineLine(engine: EngineFingerprint, root: string): string {
  if (engine.patch === undefined) return `engine ${engine.id}`;

  const { file } = engine.patch;
  const shown = isBelow(file, root) ? path.relative(root, file) : file;

  return `engine ${engine.id} (${shown})`;
}
