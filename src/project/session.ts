/**
 * @file project — an open project: the real root, the catalog of its files, the stamps of the last
 * walk, the tsconfig aliases with the stamps of the config files they came from, the current index
 * and a queue that runs one update at a time. `syncWithDisk` is the batch walk of a watch batch:
 * it walks the root, hashes the files whose stamp moved and every new one, drops the vanished
 * ones, reads the aliases again when a config file moved, and rebuilds the index when bytes or
 * aliases changed. `reindexPath` reads one path now for `changed`.
 */
import path from "node:path";
import { type AliasMap, readAliases, sameAliases } from "./aliases";
import { buildIndex, type Catalog, createCatalog, dropFile, putFile } from "./catalog";
import { diffIndexes } from "./change";
import { isIndexedFile, openRoot, readInside, resolveInside, toPosix } from "./paths";
import type { JsxShapes } from "./shapes";
import type { ProjectChange, ProjectIndex, ProjectOptions } from "./types";
import { loadTypeScript } from "./typescript";
import { type Stamp, sameStamp, stampOf, walkRoot } from "./walk";

/**
 * Everything one open project holds behind its handle: the real root, the catalog of its files
 * and parses, the stamps and folders of the last walk, the current index, the JSX shapes `find`
 * read from it, and the queue that runs one update at a time. It never leaves `src/project/`;
 * a game sees only the `ProjectApi` built on it.
 */
export type Session = {
  /** The real absolute root every read is held to. */
  readonly root: string;
  /** The root-relative manifest path the index reports when the file exists. */
  readonly manifest: string;
  /** The root-relative tsconfig path the aliases are read from. */
  readonly tsconfig: string;
  /** The tsconfig aliases every name is followed through; none when the file holds no `paths`. */
  aliases: AliasMap | undefined;
  /**
   * The stamp of every config file the last read of the tsconfig touched, with or without
   * `paths`; the tsconfig alone when it is missing. `undefined` for a file that is not there. A
   * moved stamp means read them again.
   */
  configStamps: Map<string, Stamp | undefined>;
  /** One record per indexed file with its last good parse, and the cache of parses. */
  readonly catalog: Catalog;
  /** The size and time stamp of every file of the last walk; a moved stamp means hash again. */
  stamps: Map<string, Stamp>;
  /** The folders of the last walk, root-relative; `""` is the root. */
  folders: string[];
  /** The current index, frozen; an update replaces it with a new object. */
  index: ProjectIndex;
  /** The JSX patterns and key-carrying props of each index `find` read, built once per index. */
  readonly shapes: WeakMap<ProjectIndex, JsxShapes>;
  /** The tail of the update queue: the next update runs after it settles. */
  queue: Promise<unknown>;
};

/** The manifest the asset scanner writes by default. */
const MANIFEST_FILE = "manifest.json";

/** The tsconfig whose `paths` are read by default. */
const TSCONFIG_FILE = "tsconfig.json";

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
 * The stamp of a config file, read through the guard.
 *
 * @param root - The real root.
 * @param file - The root-relative path.
 * @returns The stamp, or `undefined` when nothing is there or the path left the root.
 */
async function configStampOf(root: string, file: string): Promise<Stamp | undefined> {
  try {
    const real = await resolveInside(root, file);

    return real === undefined ? undefined : await stampOf(real);
  } catch {
    // A symlink that leads out of the root now: nothing there to read.
    return undefined;
  }
}

/**
 * The stamps of config files.
 *
 * @param root - The real root.
 * @param files - The root-relative config files.
 * @returns Path to stamp, `undefined` for a file that is not there.
 */
async function stampConfigs(
  root: string,
  files: readonly string[]
): Promise<Map<string, Stamp | undefined>> {
  const stamps = new Map<string, Stamp | undefined>();

  for (const file of files) stamps.set(file, await configStampOf(root, file));

  return stamps;
}

/**
 * The config files a read of the tsconfig touched: its sources, or the tsconfig alone when it is
 * missing.
 *
 * @param tsconfig - The root-relative tsconfig path.
 * @param read - The read, `undefined` for a missing tsconfig.
 * @returns The root-relative files to stamp.
 * @example
 * ```ts
 * configsOf("tsconfig.json", undefined); // ["tsconfig.json"]
 * ```
 */
function configsOf(tsconfig: string, read: AliasMap | undefined): readonly string[] {
  return read?.sources ?? [tsconfig];
}

/**
 * The aliases the index follows: a tsconfig without patterns maps nothing, as no tsconfig does.
 *
 * @param read - The read, `undefined` for a missing tsconfig.
 * @returns The read when it holds a pattern, else `undefined`.
 * @example
 * ```ts
 * followedAliases({ file: "tsconfig.json", sources: ["tsconfig.json"], patterns: [] }); // undefined
 * ```
 */
function followedAliases(read: AliasMap | undefined): AliasMap | undefined {
  return read === undefined || read.patterns.length === 0 ? undefined : read;
}

/**
 * Whether a config file moved, appeared or vanished since its stamp.
 *
 * @param session - The project.
 * @returns True when a stamp of `configStamps` is not the one on disk now.
 */
async function configsMoved(session: Session): Promise<boolean> {
  for (const [file, known] of session.configStamps) {
    const now = await configStampOf(session.root, file);
    const isMoved =
      known === undefined || now === undefined ? known !== now : !sameStamp(known, now);

    if (isMoved) return true;
  }

  return false;
}

/**
 * Reads the aliases again and stamps the config files the read touched. A tsconfig that stops
 * parsing keeps the aliases it had until it parses again, as a broken source file keeps its keys,
 * and the files of the last good read are stamped again.
 *
 * @param session - The project.
 * @returns True when the aliases resolve differently now.
 */
async function rereadAliases(session: Session): Promise<boolean> {
  const before = session.aliases;
  let configs: readonly string[] = [...session.configStamps.keys()];

  try {
    const read = await readAliases(session.catalog.typescript, session.root, session.tsconfig);

    session.aliases = followedAliases(read);
    configs = configsOf(session.tsconfig, read);
  } catch {
    // The tsconfig does not parse now: the last good aliases stay.
  }

  session.configStamps = await stampConfigs(session.root, configs);

  return !sameAliases(before, session.aliases);
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

  session.index = buildIndex(session.catalog, manifest, session.aliases);

  return diffIndexes(before, session.index, files);
}

/**
 * Opens a project: checks the root, loads TypeScript, reads the tsconfig aliases and every source
 * file, and builds the index.
 *
 * @param options - The root, the manifest, the tsconfig and the debounce.
 * @returns The open project.
 * @throws {Error} When the root is missing or not a directory, the manifest or the tsconfig path
 *   leaves the root, the tsconfig does not parse, or TypeScript is not installed.
 */
export async function openSession(options: ProjectOptions): Promise<Session> {
  const root = await openRoot(options.root);
  const typescript = await loadTypeScript();
  const manifest = toPosix(options.manifest ?? MANIFEST_FILE);
  const tsconfig = toPosix(options.tsconfig ?? TSCONFIG_FILE);

  await resolveInside(root, manifest);
  await resolveInside(root, tsconfig);

  // The aliases come first: every build of the index follows names through them. Every config
  // file of the read is stamped, with or without `paths`.
  const read = await readAliases(typescript, root, tsconfig);
  const aliases = followedAliases(read);

  // One walk lists the files; each is read through the guard and parsed once.
  const walk = await walkRoot(root);
  const catalog = createCatalog(typescript);
  const session: Session = {
    root,
    manifest,
    tsconfig,
    aliases,
    configStamps: await stampConfigs(root, configsOf(tsconfig, read)),
    catalog,
    stamps: walk.files,
    folders: walk.folders,
    index: buildIndex(catalog, undefined, aliases),
    shapes: new WeakMap(),
    queue: Promise.resolve()
  };

  for (const file of [...walk.files.keys()].toSorted()) await readIntoCatalog(session, file);

  session.index = buildIndex(catalog, await presentManifest(root, manifest), aliases);

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
 * vanished ones, reads the aliases again when a config file moved, appeared or vanished, and
 * rebuilds the index when bytes or aliases changed. A save with the same bytes, or a tsconfig
 * edit that leaves the aliases as they were, changes nothing. New aliases list the tsconfig
 * among the changed files.
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

    if (isUnmoved) continue;

    const isChanged = await readIntoCatalog(session, file);

    if (isChanged) files.push(file);
  }

  // The config files of the aliases: a moved one reads them again.
  const moved = await configsMoved(session);
  const aliasesChanged = moved && (await rereadAliases(session));

  if (aliasesChanged) files.push(session.tsconfig);

  const manifest = await presentManifest(session.root, session.manifest);

  if (files.length === 0 && manifest === session.index.manifest) return undefined;

  return rebuild(session, files);
}

/**
 * Reads one root-relative path now: a changed or new source file is parsed, a deleted one is
 * dropped, the tsconfig or a file it extends reads the aliases again, and anything else changes
 * nothing.
 *
 * @param session - The project.
 * @param file - The root-relative path.
 * @returns The index after the read.
 * @throws {Error} When the path leaves the root.
 */
export async function reindexPath(session: Session, file: string): Promise<ProjectIndex> {
  const relative = toPosix(file);
  const real = await resolveInside(session.root, relative);

  if (path.isAbsolute(relative)) return session.index;

  // A config file of the aliases: the index is rebuilt when they resolve differently now.
  if (session.configStamps.has(relative)) {
    if (await rereadAliases(session)) await rebuild(session, [session.tsconfig]);

    return session.index;
  }

  // A symlink inside the root and a file outside the index change nothing: the walk never lists
  // them either.
  const isLinked = real !== undefined && real !== path.join(session.root, relative);

  if (isLinked || !isIndexedFile(relative)) return session.index;

  // The stamp follows the read, so the next walk does not hash the file again.
  const stamp = real === undefined ? undefined : await stampOf(real);

  if (stamp !== undefined) session.stamps.set(relative, stamp);

  const isChanged = await readIntoCatalog(session, relative);

  if (!isChanged) return session.index;

  await rebuild(session, [relative]);

  return session.index;
}
