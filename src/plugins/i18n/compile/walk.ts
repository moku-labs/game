/**
 * @file i18n plugin, build time — the walk over `features/*​/strings/<locale>.json`: every file
 * read, every key claimed by one feature, every message compiled once and every problem collected,
 * with the text and the translator note of each key kept aside. `compileStrings`, `exportStrings`
 * and `importStrings` all start from it. Node and Bun only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LocaleEntry } from "./emit";
import { compileMessage, type ParameterType } from "./message";

/** How every problem of the string compiler is prefixed. */
export const PREFIX = "[game] i18n: ";

/**
 * What one value of a string file may be: the message, or the message with a note for the
 * translators. The note is read by people only and never reaches a generated file.
 */
export type MessageEntry = string | { text: string; note?: string };

/** Where one message came from. */
export type Source = { feature: string; locale: string; relative: string };

/** One parameter of one key, with the file that first typed it that way. */
export type ParameterOrigin = { type: ParameterType; relative: string };

/** One string file of one feature. */
export type StringFile = {
  feature: string;
  locale: string;
  /** Path of the file. */
  file: string;
  /** The path a problem names it by: `features/<feature>/strings/<locale>.json`. */
  relative: string;
};

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
 * Lists the sub-folders of a folder that may not exist.
 *
 * @param folder - Path of the folder.
 * @returns The names, sorted.
 */
async function listFolders(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });

    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .toSorted();
  } catch {
    return [];
  }
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
 * Lists every string file of a game: features sorted, then locales sorted.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @returns The files, in walk order.
 */
export async function listStringFiles(root: string, features: string): Promise<StringFile[]> {
  const files: StringFile[] = [];
  const featuresFolder = path.join(root, features);

  for (const feature of await listFolders(featuresFolder)) {
    const stringsFolder = path.join(featuresFolder, feature, "strings");

    for (const locale of await listLocales(stringsFolder)) {
      files.push({
        feature,
        locale,
        file: path.join(stringsFolder, `${locale}.json`),
        relative: `features/${feature}/strings/${locale}.json`
      });
    }
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
 * Records which feature owns a key, refusing the same key in two features.
 *
 * @param walk - What the walk collects.
 * @param key - The message key.
 * @param source - Where this message came from.
 * @returns True when the key belongs to this feature.
 */
function claim(walk: Walk, key: string, source: Source): boolean {
  const known = walk.owner.get(key);

  if (known === undefined) {
    walk.owner.set(key, source);

    return true;
  }

  if (known.feature === source.feature) return true;

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
 * Walks every string file of a game and compiles every message once. Problems are collected, not
 * thrown, so the caller reports them all in one error.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @returns The compiled messages per locale, the owner and parameters of each key, the texts and
 *   notes of each key per locale, and every problem.
 */
export async function walkStrings(root: string, features: string): Promise<Walk> {
  const walk: Walk = {
    byLocale: emptyLocales(),
    owner: emptyOwners(),
    params: emptyParameters(),
    problems: [],
    texts: emptyTexts(),
    notes: emptyTexts()
  };

  for (const file of await listStringFiles(root, features)) {
    const table = await readTable(file.file, file.relative, walk);

    if (table === undefined) continue;

    const source: Source = { feature: file.feature, locale: file.locale, relative: file.relative };

    for (const [key, value] of Object.entries(table)) compileOne(walk, key, value, source);
  }

  return walk;
}
