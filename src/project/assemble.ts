/**
 * @file project — the cross-file pass that turns the records of a catalog into the index: every
 * definition, the `node:` keys of each flow table followed to the file that declares the node,
 * the files that import each style, the files that render each component, conflicts, the files with their hashes, the unresolved items
 * and the revision. Names are followed through relative imports and the tsconfig aliases. The
 * result is frozen: a watch batch replaces it, nothing mutates it.
 */
import type { AliasMap } from "./aliases";
import type { FileRecord } from "./catalog";
import { COMPONENT } from "./extract/components";
import type { NodeTable, Unresolved } from "./extract/definitions";
import { type Modules, missedAlias, type Resolution, resolveBinding } from "./extract/resolve";
import { revisionOf } from "./hash";
import { JSX } from "./shapes";
import type { Anchor, ProjectIndex } from "./types";

/** The prefix of a node key. */
const NODE = "node:";

/**
 * What the pass reads: every record sorted by path, the module facts of the good files, and the
 * tsconfig aliases when the game declares some.
 */
export type Assembly = {
  readonly files: readonly (readonly [path: string, record: FileRecord])[];
  readonly modules: Modules;
  readonly aliases?: AliasMap | undefined;
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
 * Why a name of a flow table cannot be followed: the alias it is imported through reaches no
 * file, or it is declared in no file of the root.
 *
 * @param resolution - The module facts and the aliases.
 * @param file - The flow file.
 * @param node - The key of the entry, `main/home`.
 * @param ref - The name the entry holds.
 * @returns The reason for the unresolved list.
 */
function unfollowed(resolution: Resolution, file: string, node: string, ref: string): string {
  const alias = missedAlias(resolution, file, ref);

  return alias === undefined
    ? `node "${node}": "${ref}" is not declared in a file of the root`
    : `node "${node}": "${ref}" is imported from "${alias}", which names no file of the root`;
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
  const resolution: Resolution = { modules: assembly.modules, aliases: assembly.aliases };

  for (const { name, ref } of table.entries) {
    const entry = entryOf(symbols, `${NODE}${table.flow}/${name}`);
    const atTable: Anchor = { ...use, key: name };
    const target = ref === undefined ? undefined : resolveBinding(resolution, file, ref);

    if (target?.kind === "declared") {
      entry.def.push({ path: target.path, binding: target.binding });
      entry.uses.push(atTable);
      continue;
    }

    entry.def.push(atTable);

    if (ref !== undefined) {
      unresolved.push({
        path: file,
        reason: unfollowed(resolution, file, `${table.flow}/${name}`, ref)
      });
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
  const resolution: Resolution = { modules: assembly.modules, aliases: assembly.aliases };

  for (const [file, record] of assembly.files) {
    for (const [local, ref] of record.good?.module.imports ?? []) {
      const target = ref.imported === "*" ? undefined : resolveBinding(resolution, file, local);
      const style =
        target?.kind === "declared"
          ? symbols.get(`style:${target.path}#${target.binding}`)
          : undefined;

      style?.uses.push({ path: file, binding: local });
    }
  }
}

/**
 * The component entries by the binding they are rendered as. Two anchors of one name in a
 * conflict share one binding, so a file that renders it is one use.
 *
 * @param symbols - The keys so far.
 * @returns Binding to the component entries bound to it.
 */
function componentsByBinding(symbols: Symbols): Map<string, Entry[]> {
  const byBinding = new Map<string, Entry[]>();

  for (const [key, entry] of symbols) {
    if (!key.startsWith(COMPONENT)) continue;

    const bindings = new Set(entry.def.flatMap(anchor => anchor.binding ?? []));

    for (const binding of bindings)
      byBinding.set(binding, [...(byBinding.get(binding) ?? []), entry]);
  }

  return byBinding;
}

/**
 * The component names one file renders.
 *
 * @param record - The record of the file.
 * @returns The names; none for a broken file.
 */
function renderedBy(record: FileRecord): readonly string[] {
  return record.good === undefined ? [] : (record.extracted?.result.rendered ?? []);
}

/**
 * Adds one use of a rendered binding to every component entry bound to it.
 *
 * @param byBinding - Binding to the component entries bound to it.
 * @param file - The file that renders the binding.
 * @param binding - The rendered name.
 */
function useComponent(byBinding: Map<string, Entry[]>, file: string, binding: string): void {
  for (const entry of byBinding.get(binding) ?? []) entry.uses.push({ path: file, binding });
}

/**
 * Adds, to every component key, the files that render its binding: one use per file and binding,
 * in path order. A member tag `<ui.RoundButton>` renders `RoundButton`.
 *
 * @param assembly - The records and module facts.
 * @param symbols - The keys so far.
 */
function addComponentUses(assembly: Assembly, symbols: Symbols): void {
  const byBinding = componentsByBinding(symbols);

  for (const [file, record] of assembly.files) {
    for (const binding of renderedBy(record)) useComponent(byBinding, file, binding);
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
    const isConflict = !key.startsWith(JSX) && def.length > 1;

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
 * Assembles the index of a catalog. The index names the tsconfig when the assembly has aliases.
 *
 * @param assembly - The records sorted by path, the module facts of the good files, the aliases.
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
  addComponentUses(assembly, symbols);

  return deepFreeze({
    schemaVersion: 1,
    revision: revisionOf(files),
    ...(manifest === undefined ? {} : { manifest }),
    ...(assembly.aliases === undefined ? {} : { tsconfig: assembly.aliases.file }),
    symbols: finishSymbols(symbols),
    files,
    unresolved
  });
}
