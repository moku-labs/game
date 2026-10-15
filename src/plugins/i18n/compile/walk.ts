/**
 * @file i18n plugin, build time — the walk over every feature owner of `findFeatureOwners` (a
 * top-level folder of `features/`, or a sub-feature at any depth) and the `strings/` of every layer:
 * every file read, every key claimed by one feature or layer, every message compiled once and every
 * problem collected, with the text and the translator note of each key kept aside.
 * `compileStrings`, `exportStrings` and `importStrings` all start from it. Node and Bun only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type FeatureOwner, findFeatureOwners } from "../../../project/features";
import type { LocaleEntry } from "./emit";
import { compileMessage, type ParameterType } from "./message";

/** How every problem of the string compiler is prefixed. */
export const PREFIX = "[game] i18n: ";

/** What a layer folder may not hold: a separator or a ".", which would lead out of the root. */
const NOT_ONE_FOLDER = /[/\\.]/;

/** What a sub-feature name may hold: it sits between two dots of `strings.<name>.<locale>.ts`. */
const MODULE_NAME = /^[\w-]+$/;

/**
 * What one value of a string file may be: the message, or the message with a note for the
 * translators. The note is read by people only and never reaches a generated file.
 */
export type MessageEntry = string | { text: string; note?: string };

/**
 * Where one message came from: the feature or layer label, the root-relative POSIX folder that
 * owns the file (`features/hud` or `shared`), the locale, the path a problem names it by, and the
 * parent feature when the owner is a sub-feature (absent for a top-level feature and a layer).
 */
export type Source = {
  feature: string;
  folder: string;
  locale: string;
  relative: string;
  parent?: string;
};

/** One parameter of one key, with the file that first typed it that way. */
export type ParameterOrigin = { type: ParameterType; relative: string };

/** One string file of one feature or layer. */
export type StringFile = {
  /** The label: the feature folder name, or the mapped name of a layer. */
  feature: string;
  /** Root-relative POSIX path of the folder that owns the file: `features/hud` or `shared`. */
  folder: string;
  locale: string;
  /** Path of the file. */
  file: string;
  /** The path a problem names it by: `<folder>/strings/<locale>.json`. */
  relative: string;
  /** The parent feature when the owner is a sub-feature; absent for a top-level feature and a layer. */
  parent?: string;
};

/** The owner one string folder is read for: its label, its folder and, for a sub-feature, its parent. */
type StringOwner = Pick<FeatureOwner, "name" | "dir" | "parent">;

/**
 * Everything one walk collects.
 */
export type Walk = {
  /** Compiled messages per locale. */
  byLocale: Map<string, LocaleEntry[]>;
  /** The feature and the file that first declared each key. */
  owner: Map<string, Source>;
  /** The merged parameters of each key. */
  params: Map<string, Map<string, ParameterOrigin>>;
  /** Every problem, in walk order. */
  problems: string[];
  /** The message of each key per locale, as the file wrote it. */
  texts: Map<string, Map<string, string>>;
  /** The translator note of each key per locale, where the file wrote one. */
  notes: Map<string, Map<string, string>>;
  /**
   * Every sub-feature that brought at least one string file: feature name to its root-relative
   * POSIX folder.
   */
  subFeatures: Map<string, string>;
};

/**
 * Creates the table of compiled messages per locale. Its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty table.
 */
function emptyLocales(): Map<string, LocaleEntry[]> {
  return new Map();
}

/**
 * Creates the table of which feature owns which key.
 *
 * @returns An empty table.
 */
function emptyOwners(): Map<string, Source> {
  return new Map();
}

/**
 * Creates the table of merged parameters per key.
 *
 * @returns An empty table.
 */
function emptyParameters(): Map<string, Map<string, ParameterOrigin>> {
  return new Map();
}

/**
 * Creates a table of key to locale to text, for the messages or the notes.
 *
 * @returns An empty table.
 */
function emptyTexts(): Map<string, Map<string, string>> {
  return new Map();
}

/**
 * Creates the table of the sub-features that brought string files.
 *
 * @returns An empty table.
 */
function emptySubFeatures(): Map<string, string> {
  return new Map();
}

/**
 * Creates the parameter table of one key.
 *
 * @returns An empty table.
 */
function emptyOrigins(): Map<string, ParameterOrigin> {
  return new Map();
}

/**
 * Creates the per-locale table of one key.
 *
 * @returns An empty table.
 */
function emptyByLocale(): Map<string, string> {
  return new Map();
}

/**
 * Reads the message of anything that was thrown.
 *
 * @param error - What the `catch` caught.
 * @returns The message.
 */
export function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collects every problem of a compile into one error.
 *
 * @param problems - The problems, in walk order.
 * @returns The error to reject with.
 */
export function compileFailure(problems: readonly string[]): Error {
  const only = problems[0];

  if (problems.length === 1 && only !== undefined) {
    return new Error(`${PREFIX}${only}\n  Fix the message or use a supported ICU feature.`);
  }

  const lines = problems.map(text => `  ${text}`).join("\n");

  return new Error(
    `${PREFIX}the compile found ${problems.length} problems.\n${lines}\n` +
      '  Fix them and run "bun run assets:keys" again.'
  );
}

/**
 * Tells whether an object is the `{ text, note }` form of a message: a string `text`, an optional
 * string `note`, and nothing else.
 *
 * @param value - One value of a string file that is an object.
 * @returns True for the noted form.
 * @example
 * ```ts
 * isNoted({ text: "Deliver", note: "Button, max 10 chars" }); // true
 * ```
 */
function isNoted(value: object): value is { text: string; note?: string } {
  const hasText = "text" in value && typeof value.text === "string";
  const noteIsText = !("note" in value) || typeof value.note === "string";
  const onlyKnown = Object.keys(value).every(name => name === "text" || name === "note");

  return hasText && noteIsText && onlyKnown;
}

/**
 * Tells whether a parsed JSON value is a table of key to value: an object, not `null`, not an
 * array.
 *
 * @param value - A parsed JSON value.
 * @returns True when the value is a table.
 * @example
 * ```ts
 * isTable(["hud.title"]); // false
 * ```
 */
export function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tells whether one value of a string file is a message: a string, or `{ text, note }`.
 *
 * @param value - One value of a string file.
 * @returns True when the value is a message.
 * @example
 * ```ts
 * isMessageEntry({ text: "Deliver", max: 10 }); // false: an extra member
 * ```
 */
export function isMessageEntry(value: unknown): value is MessageEntry {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  return isNoted(value);
}

/**
 * Compares two texts by code unit, the order `.toSorted()` gives strings.
 *
 * @param left - One text.
 * @param right - The other text.
 * @returns A negative number, zero or a positive number.
 * @example compareText("features/Board", "features/apple"); // -1
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

/**
 * Lists the locales one feature brought, by the names of its string files.
 *
 * @param folder - Path of the `strings` folder.
 * @returns The locale names, sorted.
 */
async function listLocales(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });

    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name.slice(0, -".json".length))
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Lists the string files of one feature or layer, locales sorted. A folder without `strings/`
 * yields nothing.
 *
 * @param root - Game source root.
 * @param owner - The label (the feature folder name, or the mapped name of a layer), the
 *   root-relative POSIX folder, and the parent of a sub-feature.
 * @returns The files of that folder.
 */
async function listOwnerFiles(root: string, owner: StringOwner): Promise<StringFile[]> {
  const folder = owner.dir;
  const stringsFolder = path.join(root, ...folder.split("/"), "strings");
  const locales = await listLocales(stringsFolder);
  const parent = owner.parent === undefined ? {} : { parent: owner.parent };

  return locales.map(locale => ({
    feature: owner.name,
    folder,
    locale,
    file: path.join(stringsFolder, `${locale}.json`),
    relative: `${folder}/strings/${locale}.json`,
    ...parent
  }));
}

/**
 * The owner record of a layer: no parent, so its keys take no prefix.
 *
 * @param folder - The layer folder under the root.
 * @param name - The name its keys take.
 * @returns The record `listOwnerFiles` reads.
 * @example layerOwner("shared", "ui"); // { name: "ui", dir: "shared" }
 */
function layerOwner(folder: string, name: string): StringOwner {
  return { name, dir: folder };
}

/**
 * The error for a layer folder that is not one folder name under the root: empty, or with a
 * separator or a "." that would read and write outside it.
 *
 * @param folder - The layer folder as given.
 * @returns The error to throw.
 */
function notAFolderName(folder: string): Error {
  return new Error(
    `${PREFIX}the layer "${folder}" is not a folder name.\n` +
      String.raw`  Use a name without "/", "\" or ".".`
  );
}

/**
 * Lists every string file of a game: the feature owners of `findFeatureOwners` (top-level features
 * and sub-features at any depth) sorted by folder in code-unit order, then the layers sorted by
 * folder; inside each, locales sorted. Every layer folder is checked before anything is read.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @param layers - Folder under the root to the name its keys take. Default `{}`: features only.
 * @returns The files, in walk order.
 * @throws {Error} When a layer folder is empty or holds "/", "\" or ".", or when one feature name
 *   belongs to two folders (the error of `findFeatureOwners`): nothing is read then.
 */
export async function listStringFiles(
  root: string,
  features: string,
  layers: Readonly<Record<string, string>> = {}
): Promise<StringFile[]> {
  // A layer folder is one folder name under the root: a path would reach outside it.
  const sortedLayers = Object.entries(layers).toSorted((left, right) =>
    left[0] < right[0] ? -1 : 1
  );
  const outside = sortedLayers.find(([folder]) => folder === "" || NOT_ONE_FOLDER.test(folder));

  if (outside !== undefined) throw notAFolderName(outside[0]);

  // The feature owners first, by folder in code-unit order (the order 0.14.12 read features in),
  // then the layers.
  const files: StringFile[] = [];
  const owners = [...findFeatureOwners(root, features)].toSorted((left, right) =>
    compareText(left.dir, right.dir)
  );

  for (const owner of owners) files.push(...(await listOwnerFiles(root, owner)));

  for (const [folder, name] of sortedLayers) {
    files.push(...(await listOwnerFiles(root, layerOwner(folder, name))));
  }

  return files;
}

/**
 * Reads one string file as a flat table of key to message.
 *
 * @param file - Path of the file.
 * @param relative - The path a problem names it by.
 * @param walk - What the walk collects.
 * @returns The table, or `undefined` when the file is a problem.
 */
async function readTable(
  file: string,
  relative: string,
  walk: Walk
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));

    if (!isTable(parsed)) {
      walk.problems.push(`${relative}: a string file is an object of key to message.`);

      return undefined;
    }

    return parsed;
  } catch (error) {
    walk.problems.push(`${relative} could not be read: ${detailOf(error)}.`);

    return undefined;
  }
}

/**
 * Records which feature or layer owns a key, refusing the same key in two folders. Folders are
 * compared, not labels: a layer mapped to `ui` and the feature folder `features/ui` are two owners.
 *
 * @param walk - What the walk collects.
 * @param key - The message key.
 * @param source - Where this message came from.
 * @returns True when the key belongs to this folder.
 */
function claim(walk: Walk, key: string, source: Source): boolean {
  const known = walk.owner.get(key);

  if (known === undefined) {
    walk.owner.set(key, source);

    return true;
  }

  if (known.folder === source.folder) return true;

  walk.problems.push(`the key "${key}" is in ${known.relative} and ${source.relative}.`);

  return false;
}

/**
 * Sorts option names and drops the repeats.
 *
 * @param options - The option names of one select, from any number of locales.
 * @returns The names, unique and sorted.
 * @example
 * ```ts
 * unique(["language", "audio", "audio"]); // ["audio", "language"]
 * ```
 */
function unique(options: readonly string[]): string[] {
  return [...new Set(options)].toSorted();
}

/**
 * Merges the parameters one locale read for a key into what the other locales read.
 *
 * @param walk - What the walk collects.
 * @param key - The message key.
 * @param params - What this locale read.
 * @param relative - The file this locale came from.
 */
function mergeParameters(
  walk: Walk,
  key: string,
  params: Record<string, ParameterType>,
  relative: string
): void {
  const merged = walk.params.get(key) ?? emptyOrigins();

  walk.params.set(key, merged);

  for (const [name, type] of Object.entries(params)) {
    const known = merged.get(name);

    if (known === undefined) {
      merged.set(name, { type, relative });
      continue;
    }

    if (known.type.kind !== type.kind) {
      walk.problems.push(
        `"${key}": the parameter "${name}" is a ${known.type.kind} in ${known.relative} ` +
          `and a ${type.kind} in ${relative}.`
      );
      continue;
    }

    if (known.type.kind === "select" && type.kind === "select") {
      merged.set(name, {
        type: {
          kind: "select",
          options: unique([...known.type.options, ...type.options])
        },
        relative: known.relative
      });
    }
  }
}

/**
 * Keeps one text of one key in one locale: the message, or its note.
 *
 * @param table - The messages or the notes of the walk.
 * @param key - The message key.
 * @param locale - The locale of the file.
 * @param text - What the file wrote.
 */
function remember(
  table: Map<string, Map<string, string>>,
  key: string,
  locale: string,
  text: string
): void {
  const byLocale = table.get(key) ?? emptyByLocale();

  byLocale.set(locale, text);
  table.set(key, byLocale);
}

/**
 * Tells whether a key may live in the file it came from: any key of a top-level feature or a
 * layer, and for a sub-feature a key that starts with `<name>.` and goes on after it.
 *
 * @param key - The message key.
 * @param source - Where this message came from.
 * @returns True when the key belongs there.
 */
function isOwnKey(key: string, source: Source): boolean {
  if (source.parent === undefined) return true;

  const prefix = `${source.feature}.`;

  return key.startsWith(prefix) && key.length > prefix.length;
}

/**
 * Records a sub-feature that brought a string file, checking its name once: the name sits between
 * two dots of its module's file name.
 *
 * @param walk - What the walk collects.
 * @param file - One string file of the walk.
 */
function noteSubFeature(walk: Walk, file: StringFile): void {
  if (file.parent === undefined || walk.subFeatures.has(file.feature)) return;

  walk.subFeatures.set(file.feature, file.folder);
  if (!MODULE_NAME.test(file.feature)) {
    walk.problems.push(
      `${file.folder}: a sub-feature name is letters, digits, "_" and "-", so generated/strings.<name>.<locale>.ts can be read back.`
    );
  }
}

/**
 * Reads one value of a string file and compiles its message into the locale it belongs to.
 *
 * @param walk - What the walk collects.
 * @param key - The message key.
 * @param value - The value the file wrote for the key.
 * @param source - Where this message came from.
 */
function compileOne(walk: Walk, key: string, value: unknown, source: Source): void {
  if (!isMessageEntry(value)) {
    walk.problems.push(
      `"${key}" in ${source.relative}: a message is a string or { "text": string, "note": string }.`
    );

    return;
  }

  // A sub-feature's keys start with its name, so its module holds its keys only.
  if (!isOwnKey(key, source)) {
    walk.problems.push(
      `"${key}" in ${source.relative}: a key of the sub-feature "${source.feature}" starts with "${source.feature}.".`
    );

    return;
  }

  if (!claim(walk, key, source)) return;

  // Keep the text and the note aside: export and import read them, the bundle never does.
  const text = typeof value === "string" ? value : value.text;

  remember(walk.texts, key, source.locale, text);
  if (typeof value !== "string" && value.note !== undefined) {
    remember(walk.notes, key, source.locale, value.note);
  }

  // Compile the message once, so a broken one is a problem naming its key and its file.
  try {
    const compiled = compileMessage(text);
    const entries = walk.byLocale.get(source.locale) ?? [];

    entries.push({ key, compiled });
    walk.byLocale.set(source.locale, entries);
    mergeParameters(walk, key, compiled.params, source.relative);
  } catch (error) {
    walk.problems.push(`"${key}" in ${source.relative}: ${detailOf(error)}.`);
  }
}

/**
 * Walks every string file of a game, the feature owners first (sub-features at any depth) and then
 * the layers, and compiles every message once. Problems are collected, not thrown, so the caller
 * reports them all in one error.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @param layers - Folder under the root to the name its keys take. Default `{}`: features only.
 * @returns The compiled messages per locale, the owner and parameters of each key, the texts and
 *   notes of each key per locale, and every problem.
 * @throws {Error} When a layer folder is empty or holds "/", "\" or ".", or when one feature name
 *   belongs to two folders: nothing is read.
 */
export async function walkStrings(
  root: string,
  features: string,
  layers: Readonly<Record<string, string>> = {}
): Promise<Walk> {
  const walk: Walk = {
    byLocale: emptyLocales(),
    owner: emptyOwners(),
    params: emptyParameters(),
    problems: [],
    texts: emptyTexts(),
    notes: emptyTexts(),
    subFeatures: emptySubFeatures()
  };

  for (const file of await listStringFiles(root, features, layers)) {
    // Recorded before the file is read, so a broken file keeps the module set stable.
    noteSubFeature(walk, file);

    const table = await readTable(file.file, file.relative, walk);

    if (table === undefined) continue;

    const source: Source = {
      feature: file.feature,
      folder: file.folder,
      locale: file.locale,
      relative: file.relative,
      ...(file.parent === undefined ? {} : { parent: file.parent })
    };

    for (const [key, value] of Object.entries(table)) compileOne(walk, key, value, source);
  }

  return walk;
}
