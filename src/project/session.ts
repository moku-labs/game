/**
 * @file project — an open project: the real root, the catalog of its files, the stamps of the last
 * walk, the current index and a queue that runs one update at a time. `syncWithDisk` is the batch
 * walk of a watch batch: it walks the root, hashes the files whose stamp moved and every new one,
 * drops the vanished ones and rebuilds the index when bytes changed. `reindexPath` reads one path
 * now for `changed`.
 */
import path from "node:path";
import { buildIndex, type Catalog, createCatalog, dropFile, putFile } from "./catalog";
import { diffIndexes } from "./change";
import { isIndexedFile, openRoot, readInside, resolveInside, toPosix } from "./paths";
import type { ProjectChange, ProjectIndex, ProjectOptions } from "./types";
import { loadTypeScript } from "./typescript";
import { type Stamp, sameStamp, stampOf, walkRoot } from "./walk";

/** An open project. */
export type Session = {
  /** The real absolute root every read is held to. */
  readonly root: string;
  /** The root-relative manifest path the index reports when the file exists. */
  readonly manifest: string;
  readonly catalog: Catalog;
  /** The stamp of every file of the last walk. */
  stamps: Map<string, Stamp>;
  /** The folders of the last walk, root-relative; `""` is the root. */
  folders: string[];
  /** The current index. */
  index: ProjectIndex;
  /** The tail of the update queue. */
  queue: Promise<unknown>;
};

/** The manifest the asset scanner writes by default. */
const MANIFEST_FILE = "manifest.json";

/**
 * The manifest path to report, when the file exists.
 *
 * @param root - The real root.
 * @param manifest - The root-relative manifest path.
 * @returns The path, or `undefined` when nothing is there.
 */
async function presentManifest(root: string, manifest: string): Promise<string | undefined> {
  try {
    if ((await resolveInside(root, manifest)) !== undefined) return manifest;
  } catch {
    // A manifest outside the root is never reported; openSession refused it already.
  }
}

/**
 * Reads one file into the catalog, or drops it when it is gone or cannot be read.
 *
 * @param session - The project.
 * @param file - The root-relative path.
 * @returns True when the catalog changed.
 */
async function readIntoCatalog(session: Session, file: string): Promise<boolean> {
  const bytes = await readInside(session.root, file);

  if (bytes === undefined) {
    session.stamps.delete(file);
    return dropFile(session.catalog, file);
  }

  return putFile(session.catalog, file, bytes);
}

/**
 * Rebuilds the index after files changed and says what changed.
 *
 * @param session - The project.
 * @param files - The paths whose bytes changed, appeared or vanished.
 * @returns The change.
 */
async function rebuild(session: Session, files: readonly string[]): Promise<ProjectChange> {
  const before = session.index;
  const manifest = await presentManifest(session.root, session.manifest);

  session.index = buildIndex(session.catalog, manifest);

  return diffIndexes(before, session.index, files);
}

/**
 * Opens a project: checks the root, loads TypeScript, reads every source file and builds the
 * index.
 *
 * @param options - The root, the manifest and the debounce.
 * @returns The open project.
 * @throws {Error} When the root is missing or not a directory, the manifest path leaves the root,
 *   or TypeScript is not installed.
 */
export async function openSession(options: ProjectOptions): Promise<Session> {
  const root = await openRoot(options.root);
  const typescript = await loadTypeScript();
  const manifest = toPosix(options.manifest ?? MANIFEST_FILE);

  await resolveInside(root, manifest);

  // One walk lists the files; each is read through the guard and parsed once.
  const walk = await walkRoot(root);
  const catalog = createCatalog(typescript);
  const session: Session = {
    root,
    manifest,
    catalog,
    stamps: walk.files,
    folders: walk.folders,
    index: buildIndex(catalog),
    queue: Promise.resolve()
  };

  for (const file of [...walk.files.keys()].toSorted()) await readIntoCatalog(session, file);

  session.index = buildIndex(catalog, await presentManifest(root, manifest));

  return session;
}

/**
 * Runs an update after the ones before it, so two never interleave.
 *
 * @param session - The project.
 * @param task - The update.
 * @returns What the update returns.
 */
export function serialize<T>(session: Session, task: () => Promise<T>): Promise<T> {
  const result = session.queue.then(task);

  session.queue = result.catch(() => {
    // The caller of this update sees its failure; the queue goes on.
  });

  return result;
}

/**
 * The batch walk: walks the root, hashes each file whose stamp moved and each new one, drops the
 * vanished ones, and rebuilds the index when bytes changed. A save with the same bytes changes
 * nothing.
 *
 * @param session - The project.
 * @returns The change, or `undefined` when the index stayed the same.
 */
export async function syncWithDisk(session: Session): Promise<ProjectChange | undefined> {
  const walk = await walkRoot(session.root);
  const files: string[] = [];

  // Files the walk no longer finds.
  for (const file of session.catalog.records.keys()) {
    if (!walk.files.has(file) && dropFile(session.catalog, file)) files.push(file);
  }

  // Files whose stamp moved, and new files: hashed; only changed bytes count.
  const previous = session.stamps;

  session.stamps = walk.files;
  session.folders = walk.folders;

  for (const [file, stamp] of walk.files) {
    const known = previous.get(file);
    const isUnmoved = known !== undefined && sameStamp(known, stamp);

    if (!isUnmoved && (await readIntoCatalog(session, file))) files.push(file);
  }

  const manifest = await presentManifest(session.root, session.manifest);

  if (files.length === 0 && manifest === session.index.manifest) return undefined;

  return rebuild(session, files);
}

/**
 * Reads one root-relative path now: a changed or new source file is parsed, a deleted one is
 * dropped, and anything the index does not read changes nothing.
 *
 * @param session - The project.
 * @param file - The root-relative path.
 * @returns The index after the read.
 * @throws {Error} When the path leaves the root.
 */
export async function reindexPath(session: Session, file: string): Promise<ProjectIndex> {
  const relative = toPosix(file);
  const real = await resolveInside(session.root, relative);

  // An absolute path, a symlink inside the root and a file outside the index change nothing:
  // the walk never lists them either.
  const isLinked = real !== undefined && real !== path.join(session.root, relative);

  if (path.isAbsolute(relative) || isLinked || !isIndexedFile(relative)) return session.index;

  // The stamp follows the read, so the next walk does not hash the file again.
  const stamp = real === undefined ? undefined : await stampOf(real);

  if (stamp !== undefined) session.stamps.set(relative, stamp);

  const isChanged = await readIntoCatalog(session, relative);

  if (!isChanged) return session.index;

  await rebuild(session, [relative]);

  return session.index;
}
