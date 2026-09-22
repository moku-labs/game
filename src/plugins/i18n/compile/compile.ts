/**
 * @file i18n plugin, build time — the walk over `features/*​/strings/<locale>.json` and the two
 * generated modules it writes. Every problem of a run is collected and reported in one error, so
 * a game fixes its messages in one round. Node and Bun only: nothing under `src/` outside this
 * folder and `src/assets.ts` imports it, so no game bundles the ICU parser.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { emitLocale, emitTypes, type LocaleEntry, type TypeEntry, writeIfChanged } from "./emit";
import { compileMessage, type ParameterType } from "./message";

/** How every problem of this compiler is prefixed. */
const PREFIX = "[game] i18n: ";

/**
 * What one compile produced.
 */
export type CompileReport = {
  /** True when an output on disk differs from what the compile produced. */
  changed: boolean;
  /** Every locale a feature brought a file for, sorted. */
  locales: readonly string[];
  /** Every message key, sorted. */
  keys: readonly string[];
  /** One line per key a locale lacks. Nothing here stops a build. */
  notes: readonly string[];
};

/**
 * What one compile is told beyond its two paths.
 */
export type CompileOptions = {
  /** True for a check run: nothing is written. */
  check?: boolean;
  /** Name of the folder that holds the features. Default `"features"`. */
  features?: string;
};

/** Where one message came from. */
type Source = { feature: string; locale: string; relative: string };

/** One parameter of one key, with the file that first typed it that way. */
type ParameterOrigin = { type: ParameterType; relative: string };

/** Everything one compile collects. */
type Walk = {
  /** Compiled messages per locale. */
  byLocale: Map<string, LocaleEntry[]>;
  /** The feature and the file that first declared each key. */
  owner: Map<string, Source>;
  /** The merged parameters of each key. */
  params: Map<string, Map<string, ParameterOrigin>>;
  problems: string[];
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
 * Reads the message of anything that was thrown.
 *
 * @param error - What the `catch` caught.
 * @returns The message.
 */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collects every problem of a compile into one error.
 *
 * @param problems - The problems, in walk order.
 * @returns The error to reject with.
 */
function collected(problems: readonly string[]): Error {
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
 * Reads one string file as a flat table of key to message.
 *
 * @param file - Path of the file.
 * @param relative - The path a problem names it by.
 * @param walk - What the compile collects.
 * @returns The table, or `undefined` when the file is a problem.
 */
async function readTable(
  file: string,
  relative: string,
  walk: Walk
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      walk.problems.push(`${relative}: a string file is an object of key to message.`);

      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    walk.problems.push(`${relative} could not be read: ${detailOf(error)}.`);

    return undefined;
  }
}

/**
 * Records which feature owns a key, refusing the same key in two features.
 *
 * @param walk - What the compile collects.
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
 * Creates the parameter table of one key.
 *
 * @returns An empty table.
 */
function emptyOrigins(): Map<string, ParameterOrigin> {
  return new Map();
}

/**
 * Merges the parameters one locale read for a key into what the other locales read.
 *
 * @param walk - What the compile collects.
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
 * Compiles one message into the locale it belongs to.
 *
 * @param walk - What the compile collects.
 * @param key - The message key.
 * @param text - The message.
 * @param source - Where this message came from.
 */
function compileOne(walk: Walk, key: string, text: unknown, source: Source): void {
  if (typeof text !== "string") {
    walk.problems.push(`"${key}" in ${source.relative}: a message must be a string.`);

    return;
  }

  if (!claim(walk, key, source)) return;

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
 * Lists the keys a locale is missing, so a translator sees the gap without the build stopping.
 *
 * @param walk - What the compile collects.
 * @param locales - Every locale of the game.
 * @returns One note per missing key, sorted.
 */
function missingNotes(walk: Walk, locales: readonly string[]): string[] {
  const notes: string[] = [];

  for (const [key, source] of [...walk.owner].toSorted((left, right) =>
    left[0] < right[0] ? -1 : 1
  )) {
    for (const locale of locales) {
      const entries = walk.byLocale.get(locale) ?? [];

      if (entries.some(entry => entry.key === key)) continue;

      notes.push(
        `the key "${key}" is missing from features/${source.feature}/strings/${locale}.json.`
      );
    }
  }

  return notes;
}

/**
 * Builds the types module out of the merged parameters.
 *
 * @param walk - What the compile collects.
 * @returns One entry per key.
 */
function typeEntries(walk: Walk): TypeEntry[] {
  const entries: TypeEntry[] = [];

  for (const [key, params] of walk.params) {
    const merged: Record<string, ParameterType> = {};

    for (const [name, origin] of params) merged[name] = origin.type;

    entries.push({ key, params: merged });
  }

  return entries;
}

/**
 * Walks `features/*​/strings/<locale>.json` of a game, compiles every message and writes the
 * generated modules: the types module `strings.ts` and one `strings.<locale>.ts` per locale. A
 * check run writes nothing and only reports whether something would change.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param out - The generated directory the modules are written into.
 * @param options - Whether this is a check run, and what the features folder is called.
 * @returns Whether an output differed, the locales, the keys and the notes.
 * @throws {Error} One error that lists every problem the compile found.
 * @example
 * ```ts
 * const report = await compileStrings("src", "src/generated");
 * // report.locales: ["en", "ru"], report.changed: true on the first run
 * ```
 */
export async function compileStrings(
  root: string,
  out: string,
  options: CompileOptions = {}
): Promise<CompileReport> {
  // Collect every message from the string tables of every feature.
  const walk: Walk = {
    byLocale: emptyLocales(),
    owner: emptyOwners(),
    params: emptyParameters(),
    problems: []
  };
  const featuresFolder = path.join(root, options.features ?? "features");

  for (const feature of await listFolders(featuresFolder)) {
    const stringsFolder = path.join(featuresFolder, feature, "strings");

    for (const locale of await listLocales(stringsFolder)) {
      const relative = `features/${feature}/strings/${locale}.json`;
      const table = await readTable(path.join(stringsFolder, `${locale}.json`), relative, walk);

      if (table === undefined) continue;

      for (const [key, text] of Object.entries(table)) {
        compileOne(walk, key, text, { feature, locale, relative });
      }
    }
  }

  // Fail once, with every problem the walk found.
  if (walk.problems.length > 0) throw collected(walk.problems);

  // Derive the locales and the keys. Without a locale there is nothing to emit.
  const locales = [...walk.byLocale.keys()].toSorted();
  const keys = [...walk.owner.keys()].toSorted();

  if (locales.length === 0) return { changed: false, locales, keys, notes: [] };

  // Build the types module and one module per locale.
  const write = options.check !== true;
  const outputs = [
    { file: path.join(out, "strings.ts"), text: emitTypes(typeEntries(walk)) },
    ...locales.map(locale => ({
      file: path.join(out, `strings.${locale}.ts`),
      text: emitLocale(walk.byLocale.get(locale) ?? [])
    }))
  ];
  let changed = false;

  // Write the modules whose text changed. A check run writes nothing.
  for (const output of outputs) {
    changed = (await writeIfChanged(output.file, output.text, write)) || changed;
  }

  return { changed, locales, keys, notes: missingNotes(walk, locales) };
}

/**
 * Tells whether the generated modules of a game are current, without writing anything. The
 * `--check` run of `bun run assets:keys` covers the strings with it.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param out - The generated directory the modules live in.
 * @returns True when nothing would change.
 * @throws {Error} One error that lists every problem the compile found.
 * @example
 * ```ts
 * await checkStrings("src", "src/generated"); // false when a message changed since the last run
 * ```
 */
export async function checkStrings(root: string, out: string): Promise<boolean> {
  const report = await compileStrings(root, out, { check: true });

  return !report.changed;
}
