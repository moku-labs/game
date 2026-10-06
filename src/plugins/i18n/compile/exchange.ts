/**
 * @file i18n plugin, build time — the exchange with translators. `exportStrings` writes one JSON
 * file per locale with every key, the source text and the note beside it; `importStrings` checks
 * the translated files against the game, writes them into the string files of the features and
 * layers that own the keys, and compiles. Node and Bun only, reached through `src/assets.ts`.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileStrings } from "./compile";
import { writeIfChanged } from "./emit";
import { compileMessage } from "./message";
import {
  compileFailure,
  detailOf,
  isMessageEntry,
  isTable,
  type MessageEntry,
  PREFIX,
  type Walk,
  walkStrings
} from "./walk";

/** The locale translators read from when none is named. */
const DEFAULT_SOURCE = "en";

/** The folder that holds the features when none is named. */
const DEFAULT_FEATURES = "features";

/** A layer map: folder under the root to the name its keys take. */
type Layers = Readonly<Record<string, string>>;

/** The extension of every string file and every exchange file. */
const JSON_EXTENSION = ".json";

/**
 * What an export and an import are told beyond their two paths.
 *
 * @example
 * ```ts
 * const options: ExchangeOptions = { source: "ru" }; // the translators read the Russian text
 * // A v15 game: the keys of shared/strings/ go out and come back with the rest.
 * const layered: ExchangeOptions = { source: "ru", layers: { shared: "ui" } };
 * ```
 */
export type ExchangeOptions = {
  /** The locale translators read from, written as `source` beside each text. Default `"en"`. */
  source?: string;
  /** Name of the folder that holds the features. Default `"features"`. */
  features?: string;
  /**
   * Layers read next to the features: folder under `root` to the name its keys take.
   * `{ shared: "ui" }` exports the keys of `<root>/shared/strings/` and imports their texts back
   * into that folder. Default `{}`: features only.
   */
  layers?: Layers;
};

/**
 * What an import is told: the exchange options and the compile that runs after the files are
 * written.
 *
 * @example
 * ```ts
 * const options: ImportOptions = { out: "src/generated", pseudo: true };
 * ```
 */
export type ImportOptions = ExchangeOptions & {
  /** Where the compile after the import writes. Default `<root>/generated`. */
  out?: string;
  /** True to write the pseudo-locale `strings.en-XA.ts` in that compile too. */
  pseudo?: boolean;
};

/**
 * What an export wrote: the locales, one file each, and how many keys each one lacks.
 *
 * @example
 * ```ts
 * const report: ExportReport = { locales: ["en", "ru"], missing: { en: 0, ru: 3 } };
 * ```
 */
export type ExportReport = {
  /** Every locale a file was written for, sorted. The source is one of them. */
  locales: readonly string[];
  /** Per exported locale, how many keys had no text there. */
  missing: Readonly<Record<string, number>>;
};

/**
 * What an import wrote into the game.
 *
 * @example
 * ```ts
 * const report: ImportReport = { locales: ["ru"], keys: 3, files: ["features/hud/strings/ru.json"] };
 * ```
 */
export type ImportReport = {
  /** Every locale an exchange file was read for, sorted. */
  locales: readonly string[];
  /** How many keys were written. */
  keys: number;
  /** The string files of the features and layers rewritten, relative to the root, sorted. */
  files: readonly string[];
};

/** One key of an exchange file. */
type ExchangeEntry = { text: string; source: string; note?: string };

/** One translated text the import will write, and the root-relative folder that owns its key. */
type Change = { folder: string; locale: string; key: string; text: string };

/** One exchange file, read. */
type ExchangeFile = { locale: string; file: string; table: Record<string, unknown> };

/** What the review of the exchange files found. */
type Review = { locales: string[]; changes: Change[]; problems: string[] };

/** The new texts of one string file of a feature or layer. */
type FileChanges = { file: string; texts: Map<string, string> };

/**
 * Writes a table the way every exchange and string file is written: 2-space indent, trailing
 * newline.
 *
 * @param table - The content.
 * @returns The text of the file.
 * @example
 * ```ts
 * jsonText({ "hud.title": "Orders" }); // '{\n  "hud.title": "Orders"\n}\n'
 * ```
 */
function jsonText(table: object): string {
  return `${JSON.stringify(table, undefined, 2)}\n`;
}

/**
 * Builds the error of a source locale that no feature has a string file for.
 *
 * @param source - The locale the export was told to read from.
 * @returns The error to reject with.
 */
function sourceMissing(source: string): Error {
  return new Error(
    `${PREFIX}the source locale "${source}" has no string file.\n  Pass "--source <locale>".`
  );
}

/**
 * Collects every problem of an import into one error.
 *
 * @param problems - The problems, in file order.
 * @returns The error to reject with.
 */
function importFailure(problems: readonly string[]): Error {
  const only = problems[0];

  if (problems.length === 1 && only !== undefined) {
    return new Error(`${PREFIX}${only}\n  Fix the file and import again.`);
  }

  const lines = problems.map(text => `  ${text}`).join("\n");

  return new Error(
    `${PREFIX}the import found ${problems.length} problems.\n${lines}\n` +
      "  Fix the files and import again."
  );
}

/**
 * Reads the strings of a game, refusing one that does not compile: an export of it would hand the
 * translators broken text, and an import could not tell where a key belongs.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @param layers - Folder under the root to the name its keys take.
 * @returns What the walk collected.
 * @throws {Error} One error that lists every problem the compile found.
 */
async function readGame(root: string, features: string, layers: Layers): Promise<Walk> {
  const walk = await walkStrings(root, features, layers);

  if (walk.problems.length > 0) throw compileFailure(walk.problems);

  return walk;
}

/**
 * Builds the exchange entry of one key in one locale. The note of the source wins over the
 * locale's own, because a translator reads the source.
 *
 * @param walk - What the walk collected.
 * @param key - The message key.
 * @param locale - The locale of the exchange file.
 * @param source - The locale translators read from.
 * @returns The entry: the locale's text or `""`, the source text or `""`, and a note if any.
 */
function exchangeEntry(walk: Walk, key: string, locale: string, source: string): ExchangeEntry {
  const texts = walk.texts.get(key);
  const notes = walk.notes.get(key);
  const note = notes?.get(source) ?? notes?.get(locale);
  const entry = { text: texts?.get(locale) ?? "", source: texts?.get(source) ?? "" };

  return note === undefined ? entry : { ...entry, note };
}

/**
 * Writes the files translators work in: one `<dir>/<locale>.json` per locale the features and
 * layers bring, the source locale included, so a new language starts as a copy of `en.json`. Every
 * key of the game is in every file, sorted: `{ text, source, note? }`, with `text: ""` where the
 * locale has no message yet. The game tree is not touched, and a second run writes the same bytes.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param dir - The folder the exchange files are written into; created when missing.
 * @param options - The source locale, the name of the features folder and the layers.
 * @returns The exported locales and how many keys each one lacks.
 * @throws {Error} When the game's strings do not compile, or no feature brings the source locale.
 * @example
 * ```ts
 * // Before a release, the game hands its strings to the translators.
 * await exportStrings("src", "translations"); // { locales: ["en", "ru"], missing: { en: 0, ru: 3 } }
 * // translations/ru.json: { "hud.bonus": { "text": "", "source": "Bonus" }, … }
 * ```
 */
export async function exportStrings(
  root: string,
  dir: string,
  options: ExchangeOptions = {}
): Promise<ExportReport> {
  const source = options.source ?? DEFAULT_SOURCE;
  const walk = await readGame(root, options.features ?? DEFAULT_FEATURES, options.layers ?? {});

  // Translators read from the source locale: it must be one the features bring.
  const locales = [...walk.byLocale.keys()].toSorted();

  if (!locales.includes(source)) throw sourceMissing(source);

  // Write one file per locale with every key, and count the keys each locale lacks.
  const keys = [...walk.owner.keys()].toSorted();
  const missing: Record<string, number> = {};

  for (const locale of locales) {
    const table: Record<string, ExchangeEntry> = {};

    for (const key of keys) table[key] = exchangeEntry(walk, key, locale, source);

    missing[locale] = keys.filter(key => walk.texts.get(key)?.has(locale) !== true).length;
    await writeIfChanged(path.join(dir, `${locale}${JSON_EXTENSION}`), jsonText(table), true);
  }

  return { locales, missing };
}

/**
 * Lists the exchange files of a folder.
 *
 * @param dir - The folder the translators handed back.
 * @param review - Where a folder that cannot be read is reported.
 * @returns The file names, sorted.
 */
async function listExchangeFiles(dir: string, review: Review): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith(JSON_EXTENSION))
      .map(entry => entry.name)
      .toSorted();
  } catch (error) {
    review.problems.push(`the folder ${dir} could not be read: ${detailOf(error)}.`);

    return [];
  }
}

/**
 * Reads one exchange file as a table of key to entry.
 *
 * @param dir - The folder the translators handed back.
 * @param name - The file name; minus `.json` it is the locale.
 * @param review - Where a file that is a problem is reported.
 * @returns The file, or `undefined` when it is a problem.
 */
async function readExchangeFile(
  dir: string,
  name: string,
  review: Review
): Promise<ExchangeFile | undefined> {
  const file = path.join(dir, name);
  const locale = name.slice(0, -JSON_EXTENSION.length);

  review.locales.push(locale);

  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));

    // An exchange file is a table of key to entry; anything else is a problem.
    if (!isTable(parsed)) {
      review.problems.push(`${file}: an import file is an object of key to entry.`);

      return undefined;
    }

    return { locale, file, table: parsed };
  } catch (error) {
    review.problems.push(`${file} could not be read: ${detailOf(error)}.`);

    return undefined;
  }
}

/**
 * Reads the text of one exchange entry. `source` and `note` are ignored: notes are written in the
 * game tree.
 *
 * @param entry - One value of an exchange file.
 * @returns The text, or `undefined` when the entry has no string `text`.
 * @example
 * ```ts
 * textOf({ text: "Заказы", source: "Orders" }); // "Заказы"
 * ```
 */
function textOf(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null || !("text" in entry)) return undefined;

  return typeof entry.text === "string" ? entry.text : undefined;
}

/**
 * Checks one entry of an exchange file against the game, and keeps it as a change when it brings
 * a new text that compiles.
 *
 * @param walk - What the walk of the game collected.
 * @param review - What the review found so far.
 * @param exchange - The exchange file the entry belongs to.
 * @param key - The key of the entry.
 */
function reviewEntry(walk: Walk, review: Review, exchange: ExchangeFile, key: string): void {
  const text = textOf(exchange.table[key]);
  const owner = walk.owner.get(key);

  // The entry must be an entry, of a key the game has.
  if (text === undefined) {
    review.problems.push(`"${key}" in ${exchange.file}: an entry is { "text": string }.`);

    return;
  }

  if (owner === undefined) {
    review.problems.push(`"${key}" in ${exchange.file} is not a key of this game.`);

    return;
  }

  // An empty text is not translated yet; an unchanged one has nothing to write.
  if (text === "" || text === walk.texts.get(key)?.get(exchange.locale)) return;

  // The text must compile, so a broken translation never lands in the game.
  try {
    compileMessage(text);
    review.changes.push({ folder: owner.folder, locale: exchange.locale, key, text });
  } catch (error) {
    review.problems.push(`"${key}" in ${exchange.file}: ${detailOf(error)}.`);
  }
}

/**
 * Reads every exchange file of a folder and checks every entry against the game. Nothing is
 * written here.
 *
 * @param walk - What the walk of the game collected.
 * @param dir - The folder the translators handed back.
 * @returns The locales read, the texts to write and every problem.
 */
async function reviewImport(walk: Walk, dir: string): Promise<Review> {
  const review: Review = { locales: [], changes: [], problems: [] };

  for (const name of await listExchangeFiles(dir, review)) {
    const exchange = await readExchangeFile(dir, name, review);

    if (exchange === undefined) continue;

    for (const key of Object.keys(exchange.table)) reviewEntry(walk, review, exchange, key);
  }

  return review;
}

/**
 * Reads a string file of a feature, or an empty table when the feature has none for the locale
 * yet. The walk checked every file that exists, so each value is a message.
 *
 * @param file - Path of the string file.
 * @returns The messages by key, in file order.
 */
async function readStrings(file: string): Promise<Record<string, MessageEntry>> {
  const text = await readFile(file, "utf8").catch(() => "{}");
  const parsed: unknown = JSON.parse(text);
  const table: Record<string, MessageEntry> = {};

  if (typeof parsed !== "object" || parsed === null) return table;

  for (const [key, value] of Object.entries(parsed)) {
    if (isMessageEntry(value)) table[key] = value;
  }

  return table;
}

/**
 * Rewrites one string file of a feature with its new texts. A key the file has keeps its place
 * and its form (`{ text, note }` keeps the note); a key it lacks is appended, the new ones sorted
 * among themselves. No other key is touched.
 *
 * @param file - Path of the string file; created when missing.
 * @param texts - The new text of each key.
 */
async function rewriteStrings(file: string, texts: ReadonlyMap<string, string>): Promise<void> {
  const table = await readStrings(file);
  const added: string[] = [];

  // Replace the text of every key the file has, in place.
  for (const [key, text] of texts) {
    const current = table[key];

    if (current === undefined) added.push(key);
    else table[key] = typeof current === "string" ? text : { ...current, text };
  }

  // Append the keys the file lacks, sorted among themselves.
  for (const key of added.toSorted()) table[key] = texts.get(key) ?? "";

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jsonText(table));
}

/**
 * Groups the changes of an import by the string file they land in: the `strings/` of the feature
 * or layer folder that owns each key.
 *
 * @param changes - Every text the import writes.
 * @param root - Game source root.
 * @returns The path and the new texts of each file, by its POSIX path relative to the root.
 */
function groupByFile(changes: readonly Change[], root: string): Map<string, FileChanges> {
  const files = new Map<string, FileChanges>();

  for (const change of changes) {
    const name = `${change.locale}${JSON_EXTENSION}`;
    const relative = `${change.folder}/strings/${name}`;
    const group = files.get(relative) ?? {
      file: path.join(root, ...change.folder.split("/"), "strings", name),
      texts: new Map<string, string>()
    };

    group.texts.set(change.key, change.text);
    files.set(relative, group);
  }

  return files;
}

/**
 * Takes translated exchange files back into the game: every `<dir>/<locale>.json` is checked
 * against the game first, then each new text is written into the string file of the feature or
 * layer that owns its key, and the strings are compiled into `out` as a dev run does. An empty text
 * and a text equal to the current message are skipped. With any problem nothing is written.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param dir - The folder the translators handed back.
 * @param options - The features folder, the layers, where the compile writes, and whether it
 *   writes `en-XA`.
 * @returns The locales read, how many keys were written and the files rewritten.
 * @throws {Error} One error that lists every problem of the exchange files, or the compile's own
 *   error after the files are written (a parameter kind that differs across locales).
 * @example
 * ```ts
 * // The translators handed back translations/ru.json with two hud texts filled in.
 * await importStrings("src", "translations", { out: "src/generated" });
 * // { locales: ["ru"], keys: 2, files: ["features/hud/strings/ru.json"] }
 * // A v15 game: the translated ui.ok lands in the layer's own file.
 * await importStrings("src", "translations", { out: "src/generated", layers: { shared: "ui" } });
 * // { locales: ["ru"], keys: 1, files: ["shared/strings/ru.json"] }
 * ```
 */
export async function importStrings(
  root: string,
  dir: string,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const features = options.features ?? DEFAULT_FEATURES;
  const layers = options.layers ?? {};
  const walk = await readGame(root, features, layers);

  // Check every exchange file before anything is written.
  const review = await reviewImport(walk, dir);

  if (review.problems.length > 0) throw importFailure(review.problems);

  // Write the new texts into the string files of the features and layers that own them.
  const byFile = groupByFile(review.changes, root);

  for (const group of byFile.values()) await rewriteStrings(group.file, group.texts);

  // Compile as a dev run does, so the generated modules match the files just written.
  await compileStrings(root, options.out ?? path.join(root, "generated"), {
    features,
    pseudo: options.pseudo === true,
    layers
  });

  return {
    locales: review.locales.toSorted(),
    keys: review.changes.length,
    files: [...byFile.keys()].toSorted()
  };
}
