/**
 * @file project — the walk of a game root: every source file the index reads, with the size and
 * the time stamps of its last write, and every folder on the way. A watch batch compares two walks
 * to know which files to hash; an event of the platform watcher is never trusted for that.
 * Symlinks are not followed: nothing outside the root is listed.
 */
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isIndexedFile, isSkippedFolder } from "./paths";

/** What a write leaves on a file: the inode, the size and both time stamps, in nanoseconds. */
export type Stamp = {
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
};

/** One walk of the root. */
export type Walk = {
  /** Every indexed file, root-relative POSIX, with its stamp. */
  readonly files: Map<string, Stamp>;
  /** Every folder walked, root-relative POSIX; `""` is the root. */
  readonly folders: string[];
};

/**
 * Reads the stamp of a file.
 *
 * @param file - The absolute path.
 * @returns The stamp, or `undefined` when the file is gone.
 */
export async function stampOf(file: string): Promise<Stamp | undefined> {
  try {
    const stats = await stat(file, { bigint: true });

    return { ino: stats.ino, size: stats.size, mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs };
  } catch {
    // Gone between the listing and the stat: the next walk does not list it.
    return;
  }
}

/**
 * Whether two stamps describe the same write.
 *
 * @param first - One stamp.
 * @param second - The other.
 * @returns True when inode, size and both time stamps are equal.
 * @example
 * ```ts
 * const stamp = { ino: 1n, size: 10n, mtimeNs: 5n, ctimeNs: 5n };
 * sameStamp(stamp, { ...stamp, size: 11n }); // false
 * ```
 */
export function sameStamp(first: Stamp, second: Stamp): boolean {
  return (
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs
  );
}

/**
 * Lists one folder, empty when it vanished during the walk.
 *
 * @param folder - The absolute folder.
 * @returns Its entries.
 */
async function entriesOf(folder: string): Promise<Dirent[]> {
  return readdir(folder, { withFileTypes: true }).catch(() => []);
}

/**
 * Reads one folder of the walk: its sub-folders join the queue, its source files join the list
 * with their stamps.
 *
 * @param root - The real root.
 * @param folder - The folder, root-relative; `""` is the root.
 * @param walk - The files so far, and the queue of folders still to read.
 * @param walk.files - The files so far.
 * @param walk.pending - The folders still to read.
 */
async function readFolder(
  root: string,
  folder: string,
  walk: { files: Map<string, Stamp>; pending: string[] }
): Promise<void> {
  for (const entry of await entriesOf(path.join(root, folder))) {
    const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;

    if (entry.isDirectory() && !isSkippedFolder(entry.name)) walk.pending.push(relative);
    if (!entry.isFile() || !isIndexedFile(relative)) continue;

    const stamp = await stampOf(path.join(root, relative));

    if (stamp !== undefined) walk.files.set(relative, stamp);
  }
}

/**
 * Walks a root: every indexed source file with its stamp and every folder outside the skipped
 * ones. Symlinks are skipped, files and folders alike.
 *
 * @param root - The real root.
 * @returns The files and the folders, root-relative POSIX.
 */
export async function walkRoot(root: string): Promise<Walk> {
  const files = new Map<string, Stamp>();
  const folders: string[] = [];
  const pending = [""];

  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    folders.push(folder);
    await readFolder(root, folder, { files, pending });
  }

  return { files, folders };
}
