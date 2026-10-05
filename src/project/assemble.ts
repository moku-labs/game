/**
 * @file project — the cross-file pass that turns the records of a catalog into the index: every
 * definition, the `node:` keys of each flow table followed to the file that declares the node,
 * the files that import each style, conflicts, the files with their hashes, the unresolved items
 * and the revision. The result is frozen: a watch batch replaces it, nothing mutates it.
 */
import type { FileRecord } from "./catalog";
import type { NodeTable, Unresolved } from "./extract/definitions";
import { type Modules, resolveBinding } from "./extract/resolve";
import { revisionOf } from "./hash";
import type { Anchor, ProjectIndex } from "./types";

/** What the pass reads: every record sorted by path, and the module facts of the good files. */
export type Assembly = {
  readonly files: readonly (readonly [path: string, record: FileRecord])[];
  readonly modules: Modules;
};

/** One key while it is collected. */
type Entry = { readonly def: Anchor[]; readonly uses: Anchor[] };

/** The keys while they are collected, in the order they are met. */
type Symbols = Map<string, Entry>;

/**
 * The entry of a key, made on first use.
 *
 * @param symbols - The keys so far.
 * @param key - The key.
 * @returns Its entry.
 */
function entryOf(symbols: Symbols, key: string): Entry {
  const existing = symbols.get(key);

  if (existing !== undefined) return existing;

  const entry: Entry = { def: [], uses: [] };

  symbols.set(key, entry);

  return entry;
}

/**
 * Adds the `node:` keys of one flow table. A plain name is followed to the file that declares
 * it, and the table is its use; a slot or an inline node is anchored at the table. A name that
 * cannot be followed is anchored at the table and listed as unresolved.
 *
 * @param assembly - The records and module facts.
 * @param symbols - The keys so far.
 * @param unresolved - The unresolved list so far.
 * @param file - The flow file.
 * @param table - The table.
 */
function addTable(
  assembly: Assembly,
  symbols: Symbols,
  unresolved: Unresolved[],
  file: string,
  table: NodeTable
): void {
  const use: Anchor =
    table.binding === undefined ? { path: file } : { path: file, binding: table.binding };

  for (const { name, ref } of table.entries) {
    const entry = entryOf(symbols, `node:${table.flow}/${name}`);
    const atTable: Anchor = { ...use, key: name };
    const target = ref === undefined ? undefined : resolveBinding(assembly.modules, file, ref);

    if (target?.kind === "declared") {
      entry.def.push({ path: target.path, binding: target.binding });
      entry.uses.push(atTable);
      continue;
    }

    entry.def.push(atTable);

    if (ref !== undefined) {
      const reason = `node "${table.flow}/${name}": "${ref}" is not declared in a file of the root`;

      unresolved.push({ path: file, reason });
    }
  }
}

/**
 * Adds, to every style key, the files that import its binding by name.
 *
 * @param assembly - The records and module facts.
 * @param symbols - The keys so far.
 */
function addStyleUses(assembly: Assembly, symbols: Symbols): void {
  for (const [file, record] of assembly.files) {
    for (const [local, ref] of record.good?.module.imports ?? []) {
      const target =
        ref.imported === "*" ? undefined : resolveBinding(assembly.modules, file, local);
      const style =
        target?.kind === "declared"
          ? symbols.get(`style:${target.path}#${target.binding}`)
          : undefined;

      style?.uses.push({ path: file, binding: local });
    }
  }
}

/**
 * The symbols as the index holds them: sorted by key, `uses` only when there are some, and
 * `conflict` on a key other than `jsx:` defined twice.
 *
 * @param symbols - The keys as collected.
 * @returns The symbols of the index.
 */
function finishSymbols(symbols: Symbols): ProjectIndex["symbols"] {
  const finished: ProjectIndex["symbols"] = {};

  const sorted = [...symbols].toSorted(([first], [second]) => (first < second ? -1 : 1));

  for (const [key, { def, uses }] of sorted) {
    const isConflict = !key.startsWith("jsx:") && def.length > 1;

    finished[key] = {
      def,
      ...(uses.length === 0 ? {} : { uses }),
      ...(isConflict ? { conflict: true } : {})
    };
  }

  return finished;
}

/**
 * Freezes a value and everything it holds.
 *
 * @param value - A plain value.
 * @returns The same value, frozen.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);

  return value;
}

/**
 * Assembles the index of a catalog.
 *
 * @param assembly - The records sorted by path, and the module facts of the good files.
 * @param manifest - The root-relative manifest path when the file exists.
 * @returns The index, frozen.
 */
export function assembleIndex(assembly: Assembly, manifest: string | undefined): ProjectIndex {
  const symbols: Symbols = new Map();
  const files: ProjectIndex["files"] = {};
  const unresolved: Unresolved[] = [];

  for (const [file, record] of assembly.files) {
    // Every file is listed with the hash of its bytes; a broken one with its error.
    files[file] = {
      hash: record.hash,
      state: record.state,
      ...(record.error === undefined ? {} : { error: record.error })
    };

    // A file that never parsed has no keys, only its error.
    const extracted = record.extracted?.result;

    if (record.good === undefined || extracted === undefined) {
      unresolved.push({ path: file, reason: record.error ?? "the file never parsed" });
      continue;
    }

    for (const { key, anchor } of extracted.definitions) entryOf(symbols, key).def.push(anchor);
    unresolved.push(...extracted.unresolved);
    for (const table of extracted.tables) addTable(assembly, symbols, unresolved, file, table);
  }

  addStyleUses(assembly, symbols);

  return deepFreeze({
    schemaVersion: 1,
    revision: revisionOf(files),
    ...(manifest === undefined ? {} : { manifest }),
    symbols: finishSymbols(symbols),
    files,
    unresolved
  });
}
