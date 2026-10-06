/**
 * @file project — which files the index reads, and the guard on every path it reads. Paths in and
 * out are root-relative POSIX. A read resolves the path against the real root with `realpath`, so
 * a `..` or a symlink that leaves the root is refused by name instead of read.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** The folders a game never edits by hand: dependencies, builds, generated code and tests. */
const SKIPPED_FOLDER = /^(?:node_modules|dist|generated|\.moku|\.git|__tests__|tests)$/;

/** The source files the index reads. */
const SOURCE_FILE = /\.tsx?$/;

/** Test files, skipped wherever they sit. */
const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

/** The hint under every root error. */
const ROOT_HINT = "Pass the folder of the game as root.";

/**
 * Whether a folder name is one the index never walks into.
 *
 * @param name - One folder name.
 * @returns True for `node_modules`, `dist`, `generated`, `.moku`, `.git`, `__tests__` and `tests`.
 * @example
 * ```ts
 * isSkippedFolder("generated"); // true
 * ```
 */
export function isSkippedFolder(name: string): boolean {
  return SKIPPED_FOLDER.test(name);
}

/**
 * Whether a root-relative path sits under a skipped folder.
 *
 * @param file - A path with `/` or `\` separators.
 * @returns True when one of its folders is skipped.
 * @example
 * ```ts
 * isSkippedPath("node_modules/pixi.js/index.ts"); // true
 * ```
 */
export function isSkippedPath(file: string): boolean {
  return file
    .split(/[/\\]/)
    .slice(0, -1)
    .some(folder => isSkippedFolder(folder));
}

/**
 * Whether the index reads a root-relative path: a `.ts` or `.tsx` file outside the skipped
 * folders that is not a test.
 *
 * @param file - A root-relative POSIX path.
 * @returns True for a source file of the index.
 * @example
 * ```ts
 * isIndexedFile("features/ui/kit.tsx"); // true
 * ```
 */
export function isIndexedFile(file: string): boolean {
  return SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !isSkippedPath(file);
}

/**
 * Turns a path into its root-relative POSIX form.
 *
 * @param file - A path with any separators.
 * @returns The path with `/` separators, `.` segments resolved.
 * @example
 * ```ts
 * toPosix("./features\\ui\\kit.tsx"); // "features/ui/kit.tsx"
 * ```
 */
export function toPosix(file: string): string {
  return path.posix.normalize(file.replaceAll("\\", "/"));
}

/**
 * Whether a file system error says nothing is at the path.
 *
 * @param error - What was thrown.
 * @returns True for `ENOENT` and `ENOTDIR`.
 */
function isMissing(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined;

  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Whether an absolute path lies inside a folder.
 *
 * @param folder - The absolute folder.
 * @param file - The absolute path.
 * @returns True for the folder itself and anything below it.
 */
function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);

  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * The error of a path that leaves the root.
 *
 * @param file - The path as it was given.
 * @param root - The real root.
 * @returns The error to throw.
 */
function leavesRoot(file: string, root: string): Error {
  return new Error(
    `[game] The path "${file}" leaves the project root.\n  Pass a path inside "${root}", relative to it.`
  );
}

/**
 * Checks the root of a project and resolves it: it exists, it is a directory, and its real path
 * is the one every read is held to.
 *
 * @param root - The root as given, absolute or relative to the working directory.
 * @returns The real absolute path of the root.
 * @throws {Error} When the root does not exist or is not a directory.
 */
export async function openRoot(root: string): Promise<string> {
  const absolute = path.resolve(root);
  const stats = await stat(absolute).catch((error: unknown) => {
    if (!isMissing(error)) throw error;

    throw new Error(`[game] The project root "${absolute}" does not exist.\n  ${ROOT_HINT}`);
  });

  if (!stats.isDirectory()) {
    throw new Error(`[game] The project root "${absolute}" is not a directory.\n  ${ROOT_HINT}`);
  }

  return realpath(absolute);
}

/**
 * Resolves a root-relative path to the real file, refusing any path that leaves the root.
 *
 * @param root - The real root.
 * @param file - The root-relative path.
 * @returns The real absolute path, or `undefined` when nothing is there.
 * @throws {Error} When the path leaves the root, by `..`, as an absolute path or by a symlink.
 */
export async function resolveInside(root: string, file: string): Promise<string | undefined> {
  const absolute = path.resolve(root, file);

  if (!isInside(root, absolute)) throw leavesRoot(file, root);

  let real: string;

  try {
    real = await realpath(absolute);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }

  if (!isInside(root, real)) throw leavesRoot(file, root);

  return real;
}

/**
 * Reads the bytes of a root-relative file through the guard. A path that leaves the root reads as
 * nothing here; `changed` refuses it by name with `resolveInside` first.
 *
 * @param root - The real root.
 * @param file - The root-relative path.
 * @returns The bytes, or `undefined` when the file is gone or lies outside the root.
 */
export async function readInside(root: string, file: string): Promise<Uint8Array | undefined> {
  try {
    const real = await resolveInside(root, file);

    if (real !== undefined) return await readFile(real);
  } catch {
    // Gone between the realpath and the read, or a symlink out of the root: nothing to read.
  }
}
