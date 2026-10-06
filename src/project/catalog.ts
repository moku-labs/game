/**
 * @file project — the catalog: one record per indexed file and a cache of parses. A file is
 * parsed once per version of its bytes; a file that stops parsing keeps its last good parse, so
 * its keys stay in the index while it is broken. Building the index reads the module facts of
 * every good file, re-extracts only the files whose bytes or reachable definers changed, and
 * assembles the result.
 */
import type { AliasMap } from "./aliases";
import { type Assembly, assembleIndex } from "./assemble";
import { type Extracted, extractFile } from "./extract/definitions";
import { type ModuleFacts, readModule } from "./extract/module";
import { definersOf, type Resolution } from "./extract/resolve";
import { sha1 } from "./hash";
import type { ProjectIndex } from "./types";
import { type Parsed, parseFile, type TypeScript } from "./typescript";

/** The last version of a file that parsed. */
export type GoodParse = {
  readonly hash: string;
  readonly text: string;
  readonly module: ModuleFacts;
};

/** What the catalog knows of one file. */
export type FileRecord = {
  /** The sha1 of the bytes last read. */
  readonly hash: string;
  readonly state: "ok" | "broken";
  /** The first parse error of a broken file. */
  readonly error?: string;
  /** The last version that parsed; a file broken from its first parse has none. */
  readonly good?: GoodParse;
  /** The keys of the good version, and the definers they were read with. */
  extracted?: { readonly definers: string; readonly result: Extracted };
};

/** The records of a project and its parse cache. */
export type Catalog = {
  readonly typescript: TypeScript;
  readonly records: Map<string, FileRecord>;
  /** `${path}\0${hash}` to the parse, oldest first. */
  readonly parses: Map<string, Parsed>;
};

/** How many parses the cache keeps; the oldest goes first. */
const PARSE_CACHE_SIZE = 512;

/**
 * Creates an empty catalog.
 *
 * @param typescript - The TypeScript module.
 * @returns The catalog.
 */
export function createCatalog(typescript: TypeScript): Catalog {
  return { typescript, records: new Map(), parses: new Map() };
}

/**
 * Parses one version of a file, or takes it from the cache.
 *
 * @param catalog - The catalog.
 * @param path - The root-relative path.
 * @param hash - The sha1 of the bytes.
 * @param text - The text of the bytes.
 * @returns The parse.
 */
export function parseCached(catalog: Catalog, path: string, hash: string, text: string): Parsed {
  const id = `${path}\0${hash}`;
  const cached = catalog.parses.get(id);

  // A hit moves to the young end, so the cache drops the parses nobody asked for.
  catalog.parses.delete(id);

  const parsed = cached ?? parseFile(catalog.typescript, path, text);

  catalog.parses.set(id, parsed);

  for (const old of catalog.parses.keys()) {
    if (catalog.parses.size <= PARSE_CACHE_SIZE) break;
    catalog.parses.delete(old);
  }

  return parsed;
}

/**
 * Takes in the bytes of a file. Unchanged bytes change nothing; bytes that parse replace the
 * good version; bytes that do not parse mark the file broken and keep the good version.
 *
 * @param catalog - The catalog.
 * @param path - The root-relative path.
 * @param bytes - The bytes on disk.
 * @returns True when the bytes differ from the ones last read.
 */
export function putFile(catalog: Catalog, path: string, bytes: Uint8Array): boolean {
  const hash = sha1(bytes);
  const record = catalog.records.get(path);

  if (record?.hash === hash) return false;

  const text = new TextDecoder().decode(bytes);
  const parsed = parseCached(catalog, path, hash, text);

  if (parsed.error === undefined) {
    const good = { hash, text, module: readModule(catalog.typescript, parsed.source) };

    catalog.records.set(path, { hash, state: "ok", good });
    return true;
  }

  catalog.records.set(path, {
    hash,
    state: "broken",
    error: parsed.error,
    ...(record?.good === undefined ? {} : { good: record.good }),
    ...(record?.extracted === undefined ? {} : { extracted: record.extracted })
  });

  return true;
}

/**
 * Drops a file that is gone.
 *
 * @param catalog - The catalog.
 * @param path - The root-relative path.
 * @returns True when the catalog held the file.
 */
export function dropFile(catalog: Catalog, path: string): boolean {
  return catalog.records.delete(path);
}

/**
 * Brings the keys of every good file up to date: a file is read again when its good version or
 * the definers it reaches changed since it was last read. An alias change that moves the
 * definers of a file moves its stamp, so a tsconfig edit re-reads exactly the files it affects.
 *
 * @param catalog - The catalog.
 * @param resolution - The module facts of every good file, and the aliases.
 */
function refreshExtractions(catalog: Catalog, resolution: Resolution): void {
  for (const [path, record] of catalog.records) {
    const good = record.good;

    if (good === undefined) continue;

    const definers = definersOf(resolution, path);
    const signature = [...definers].map(([callee, definer]) => `${callee}=${definer}`).join(";");
    const stamp = `${good.hash}|${signature}`;

    if (record.extracted?.definers === stamp) continue;

    const { source } = parseCached(catalog, path, good.hash, good.text);

    record.extracted = {
      definers: stamp,
      result: extractFile(catalog.typescript, source, path, definers)
    };
  }
}

/**
 * Builds the index of everything the catalog holds.
 *
 * @param catalog - The catalog.
 * @param manifest - The root-relative manifest path when the file exists.
 * @param aliases - The tsconfig aliases when the game declares some.
 * @returns The index, frozen.
 */
export function buildIndex(catalog: Catalog, manifest?: string, aliases?: AliasMap): ProjectIndex {
  const files = [...catalog.records].toSorted(([first], [second]) => (first < second ? -1 : 1));
  const modules = new Map<string, ModuleFacts>();

  for (const [path, record] of files) {
    if (record.good !== undefined) modules.set(path, record.good.module);
  }

  refreshExtractions(catalog, { modules, aliases });

  const assembly: Assembly = { files, modules, aliases };

  return assembleIndex(assembly, manifest);
}
