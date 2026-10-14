/**
 * @file project — the feature folders of a game, found by folder structure: every folder of `features/`, and inside a
 * feature a folder with a door `index.ts` and resources of its own (`assets/`, `assets.ts` or `strings/`), at any
 * depth. Node and bun only; it imports `node:fs` and `node:path` alone, so `src/lint.ts` loads it unbuilt.
 */
import type { Dirent } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * One feature folder of a game: a feature owner (a folder of `features/`, or a folder inside an owner with a door
 * `index.ts` and `assets/`, `assets.ts` or `strings/` of its own), or, from `findFeatureUnits` only, a code-only
 * sub-feature its parent's door imports and lists.
 */
export type FeatureOwner = {
  /** The feature name: the folder name. */
  readonly name: string;
  /** The root-relative POSIX folder: `features/episodes/ep01`. */
  readonly dir: string;
  /** The name of the owner the folder sits in; absent for a folder of `features/`. */
  readonly parent?: string;
  /** 0 for a folder of `features/`, the parent's depth + 1 below. */
  readonly depth: number;
  /** What the folder brings of its own: `assets/` or `assets.ts`, and `strings/`. Both false for a code-only sub-feature. */
  readonly resources: { readonly assets: boolean; readonly strings: boolean };
};

/** The folders that hold one kind of code or resource of a feature: never a sub-feature, whatever they hold. */
const KIND_FOLDER =
  /^(?:flow|views|rules|styles|motion|world|effects|nodes|assets|strings|content|__tests__)$/;

/** The file names of a door, in the order a door is looked for. */
const DOORS = ["index.ts", "index.tsx"] as const;

/** A `//` comment to the end of the line or a block comment, whichever starts first. */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** An import declaration: the text up to its source (the clause and `from`), and the source. */
const IMPORT = /\bimport\b([^;"']*)["']([^"']+)["']/g;

/** A `features: [ … ]` property, key bare or quoted, up to the first `]`. */
const LISTING = /(?:\bfeatures|"features"|'features')\s*:\s*\[([^\]]*)\]/g;

/** An identifier. */
const IDENTIFIER = /[$A-Z_a-z][\w$]*/g;

/** A source naming a folder beside the door: `./<folder>`, `./<folder>/index`, either with `.ts`, `.tsx` or `.js`. */
const FOLDER_SOURCE = /^\.\/([^/]+?)(?:\/index)?(?:\.(?:tsx?|js))?$/;

/**
 * Finds every feature owner of a game: each folder of the features folder, and inside an owner each folder (not a kind
 * folder such as `flow/` or `assets/`) with a door `index.ts` and resources of its own, at any depth. Depth first, a
 * parent before its children, siblings sorted as the asset scanner sorts features. Reads folders only, never a door.
 *
 * @param root - The game folder.
 * @param features - The name of the folder that holds the features. Default `"features"`.
 * @returns The owners; none when the features folder is missing.
 * @throws {Error} When one feature name belongs to two folders; the message names both.
 * @example
 * ```ts
 * // tests/fixtures/episodes-game
 * findFeatureOwners("tests/fixtures/episodes-game").map(owner => owner.dir);
 * // ["features/episodes", "features/episodes/ep01", "features/episodes/ep02",
 * //  "features/episodes/episodes-kit", "features/home"]
 * ```
 */
export function findFeatureOwners(root: string, features = "features"): readonly FeatureOwner[] {
  return walk(root, features, false);
}

/**
 * Finds every feature folder lint and the project index treat as a unit: the owners of `findFeatureOwners`, and
 * inside an owner each code-only folder with a door that the owner's door imports from `./<folder>` and lists in
 * `features: [...]`. Reads the owners' doors as text, never with TypeScript. Same order and the same name check as
 * `findFeatureOwners`. A code-only sub-feature declares no sub-features: its own folders are never searched.
 *
 * @param root - The game folder.
 * @param features - The name of the folder that holds the features. Default `"features"`.
 * @returns The owners and the code-only sub-features; none when the features folder is missing.
 * @throws {Error} When one feature name belongs to two folders; the message names both.
 * @example
 * ```ts
 * // features/episodes/index.ts imports { toolsFeature } from "./tools" and lists it in features: [...];
 * // features/episodes/tools/ has an index.ts and code only.
 * findFeatureUnits("game").find(unit => unit.name === "tools");
 * // { name: "tools", dir: "features/episodes/tools", parent: "episodes", depth: 1, resources: { assets: false, strings: false } }
 * ```
 */
export function findFeatureUnits(root: string, features = "features"): readonly FeatureOwner[] {
  return walk(root, features, true);
}

/**
 * The owner a root-relative path belongs to: the one with the longest `dir` that is the path or a folder above it.
 *
 * @param owners - The owners of `findFeatureOwners`, or the units of `findFeatureUnits`.
 * @param file - A root-relative POSIX path, a file or a folder, with or without an extension.
 * @returns The deepest owner holding it; `undefined` outside every owner.
 * @example
 * ```ts
 * ownerOf([{ dir: "features/episodes" }, { dir: "features/episodes/ep01" }], "features/episodes/ep01/flow/story.ts")?.dir; // "features/episodes/ep01"
 * ```
 */
export function ownerOf<Owner extends { readonly dir: string }>(
  owners: readonly Owner[],
  file: string
): Owner | undefined {
  let deepest: Owner | undefined;
  for (const owner of owners) {
    const inside = file === owner.dir || file.startsWith(`${owner.dir}/`);
    if (inside && (deepest === undefined || owner.dir.length > deepest.dir.length)) deepest = owner;
  }
  return deepest;
}

/**
 * Walks the features folder: each of its folders is an owner, and below each owner its sub-features.
 *
 * @param root - The game folder.
 * @param features - The features folder, relative to the root.
 * @param units - True to add the code-only sub-features the owners' doors list.
 * @returns The owners (and units), depth first, siblings sorted.
 * @throws {Error} When one feature name belongs to two folders.
 */
function walk(root: string, features: string, units: boolean): FeatureOwner[] {
  const top = path.join(root, features);
  const base = features.replaceAll("\\", "/");
  const found: FeatureOwner[] = [];
  for (const entry of sorted(list(top).filter(item => item.isDirectory()))) {
    const folder = path.join(top, entry.name);
    const entries = list(folder);
    const owner = {
      name: entry.name,
      dir: path.posix.join(base, entry.name),
      depth: 0,
      resources: resourcesOf(entries)
    };
    collect(found, owner, folder, entries, units);
  }
  checkNames(found);
  return found;
}

/**
 * Adds an owner, then its sub-features in sibling order: an owner sub-feature with its own sub-features, a code-only
 * one its door lists as a leaf.
 *
 * @param found - The list to add to, in walk order.
 * @param owner - The owner to add.
 * @param folder - The owner's folder on disk.
 * @param entries - The entries of that folder.
 * @param units - True to add the code-only sub-features the door lists.
 */
function collect(
  found: FeatureOwner[],
  owner: FeatureOwner,
  folder: string,
  entries: readonly Dirent[],
  units: boolean
): void {
  found.push(owner);
  const listed = units ? listedIn(folder, entries) : [];
  for (const child of sorted(entries.filter(entry => isCandidate(entry)))) {
    const childFolder = path.join(folder, child.name);
    const childEntries = list(childFolder);
    if (doorOf(childEntries) === undefined) continue;
    const resources = resourcesOf(childEntries);
    const sub = {
      name: child.name,
      dir: `${owner.dir}/${child.name}`,
      parent: owner.name,
      depth: owner.depth + 1
    };
    if (resources.assets || resources.strings) {
      collect(found, { ...sub, resources }, childFolder, childEntries, units);
    } else if (listed.includes(child.name)) {
      found.push({ ...sub, resources });
    }
  }
}

/**
 * Tells whether a folder entry may be a sub-feature: a folder, not a kind folder, not a dot folder.
 *
 * @param entry - An entry of an owner's folder.
 * @returns True when the entry is worth a look.
 */
function isCandidate(entry: Dirent): boolean {
  return entry.isDirectory() && !KIND_FOLDER.test(entry.name) && !entry.name.startsWith(".");
}

/**
 * Lists a folder; a folder that is missing, a file or unreadable counts as empty.
 *
 * @param folder - The folder on disk.
 * @returns Its entries.
 */
function list(folder: string): Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Sorts folder entries by name, with the comparator the asset scanner sorts features with.
 *
 * @param entries - The entries.
 * @returns A sorted copy.
 */
function sorted(entries: readonly Dirent[]): Dirent[] {
  return entries.toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * The door of a folder: `index.ts`, else `index.tsx`.
 *
 * @param entries - The entries of the folder.
 * @returns The door's file name; `undefined` without one.
 */
function doorOf(entries: readonly Dirent[]): string | undefined {
  return DOORS.find(door => entries.some(entry => entry.isFile() && entry.name === door));
}

/**
 * What a folder brings of its own.
 *
 * @param entries - The entries of the folder.
 * @returns Whether it has `assets/` or `assets.ts`, and whether it has `strings/`.
 */
function resourcesOf(entries: readonly Dirent[]): FeatureOwner["resources"] {
  const has = (name: string, folder: boolean): boolean =>
    entries.some(entry => entry.name === name && (folder ? entry.isDirectory() : entry.isFile()));
  return { assets: has("assets", true) || has("assets.ts", false), strings: has("strings", true) };
}

/**
 * The folders an owner's door imports and lists in `features: [...]`. A door that cannot be read lists nothing.
 *
 * @param folder - The owner's folder on disk.
 * @param entries - The entries of that folder.
 * @returns The listed folder names.
 */
function listedIn(folder: string, entries: readonly Dirent[]): string[] {
  const door = doorOf(entries);
  if (door === undefined) return [];
  try {
    return listedFolders(readFileSync(path.join(folder, door), "utf8"));
  } catch {
    return [];
  }
}

/**
 * The folders a door imports from `./<folder>` (not `import type`) and names in a `features: [...]` array, comments
 * removed first. A text scan, not a parse.
 *
 * @param doorText - The text of the door.
 * @returns The folder names, in import order.
 * @example listedFolders('import { kitFeature } from "./kit";\nexport const f = defineFeature("a", { features: [kitFeature] });'); // ["kit"]
 */
function listedFolders(doorText: string): string[] {
  const text = doorText.replaceAll(COMMENT, "");
  const listed = new Set<string>();
  for (const [, items = ""] of text.matchAll(LISTING)) {
    for (const [identifier] of items.matchAll(IDENTIFIER)) listed.add(identifier);
  }
  const folders = new Set<string>();
  for (const [, head = "", source = ""] of text.matchAll(IMPORT)) {
    const folder = FOLDER_SOURCE.exec(source)?.[1];
    const clause = head.trim().replace(/from$/, "");
    if (folder === undefined || /^type\s/.test(clause)) continue;
    if (localNames(clause).some(name => listed.has(name))) folders.add(folder);
  }
  return [...folders];
}

/**
 * The local names an import clause binds at runtime: the default import, the namespace import and each named
 * specifier that is not `type`-only (`a as b` gives `b`).
 *
 * @param clause - The text between `import` and `from`.
 * @returns The local names.
 * @example localNames("main, { a as b, type c, d }"); // ["b", "d", "main"]
 */
function localNames(clause: string): string[] {
  const open = clause.indexOf("{");
  const close = clause.indexOf("}");
  const named = open === -1 ? [] : clause.slice(open + 1, close).split(",");
  const outside = open === -1 ? clause : clause.slice(0, open) + clause.slice(close + 1);
  const names: string[] = [];
  for (const part of [...named, ...outside.split(",")]) {
    const words = part.trim().split(/\s+/);
    if (words[0] === "type" && words.length > 1) continue;
    const name = words.at(-1);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Refuses a feature name used by two folders, before anything is returned. The first folder is the earlier one in
 * walk order.
 *
 * @param found - The owners (and units), in walk order.
 * @throws {Error} For the first name met twice; the message names both folders and a free name.
 */
function checkNames(found: readonly FeatureOwner[]): void {
  const seen = new Map<string, FeatureOwner>();
  for (const owner of found) {
    const first = seen.get(owner.name);
    if (first !== undefined) {
      const parent = owner.parent ?? first.parent;
      throw new Error(
        `[game] features: the feature name "${owner.name}" is taken by two folders: ${first.dir} and ${owner.dir}.\n` +
          `  A feature is named like its folder, once in the game. Name a shared sub-feature after its parent: ${parent}-${owner.name}.`
      );
    }
    seen.set(owner.name, owner);
  }
}
