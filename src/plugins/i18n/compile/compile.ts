/**
 * @file i18n plugin, build time — `compileStrings`: the walk over `features/*​/strings/<locale>.json`
 * and the `strings/` of every layer turned into the generated modules, and on request the
 * pseudo-locale `en-XA` derived from English. Every problem of a run is collected and reported in
 * one error, so a game fixes its messages in one round. Node and Bun only: nothing under `src/`
 * outside this folder and `src/assets.ts` imports it, so no game bundles the ICU parser.
 */
import path from "node:path";
import { emitLocale, emitTypes, type LocaleEntry, type TypeEntry, writeIfChanged } from "./emit";
import { compileElements, type ParameterType, parseMessage } from "./message";
import { pseudoMessage } from "./pseudo";
import { compileFailure, listStringFiles, PREFIX, type Walk, walkStrings } from "./walk";

/** The locale the pseudo-locale is derived from. */
const PSEUDO_SOURCE = "en";

/** The pseudo-locale `--pseudo` writes. */
const PSEUDO_LOCALE = "en-XA";

/**
 * What one compile produced.
 */
export type CompileReport = {
  /** True when an output on disk differs from what the compile produced. */
  changed: boolean;
  /** Every locale a feature brought a file for, and `en-XA` with `pseudo`, sorted. */
  locales: readonly string[];
  /** Every message key, sorted. */
  keys: readonly string[];
  /** One line per key a locale lacks. Nothing here stops a build. */
  notes: readonly string[];
};

/**
 * What one compile is told beyond its two paths.
 *
 * @example
 * ```ts
 * // A v15 game: the dev build writes en-XA, and shared/strings/ compiles next to the features.
 * const options: CompileOptions = { pseudo: true, layers: { shared: "ui" } };
 * ```
 */
export type CompileOptions = {
  /** True for a check run: nothing is written. */
  check?: boolean;
  /** Name of the folder that holds the features. Default `"features"`. */
  features?: string;
  /** True to also write `strings.en-XA.ts`, the pseudo-locale, from the `"en"` messages. */
  pseudo?: boolean;
  /**
   * Layers walked next to the features: folder under `root` to the name its keys take.
   * `{ shared: "ui" }` reads `<root>/shared/strings/<locale>.json` exactly as a feature's
   * `strings/` is read. A folder is one name, without "/", "\" or ".". Default `{}`: features
   * only.
   */
  layers?: Readonly<Record<string, string>>;
};

/**
 * Wraps a pseudo run without English in the message shape of the framework.
 *
 * @returns The error to reject with.
 */
function pseudoNeedsEnglish(): Error {
  return new Error(
    `${PREFIX}"--pseudo" needs an "en" string file in at least one feature.\n` +
      '  Add features/<feature>/strings/en.json or drop "--pseudo".'
  );
}

/**
 * Tells whether at least one feature or layer brings a string file for a locale.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param features - Name of the folder that holds the features.
 * @param layers - Folder under the root to the name its keys take.
 * @param locale - The locale to look for.
 * @returns True when a feature or a layer has `strings/<locale>.json`.
 */
async function bringsLocale(
  root: string,
  features: string,
  layers: Readonly<Record<string, string>>,
  locale: string
): Promise<boolean> {
  const files = await listStringFiles(root, features, layers);

  return files.some(file => file.locale === locale);
}

/**
 * Derives the pseudo message of every English message. Each one compiled already in the walk, so
 * nothing here can fail.
 *
 * @param walk - What the walk collected.
 * @returns One entry per English key.
 */
function pseudoEntries(walk: Walk): LocaleEntry[] {
  const entries: LocaleEntry[] = [];

  for (const [key, texts] of walk.texts) {
    const english = texts.get(PSEUDO_SOURCE);

    if (english === undefined) continue;

    entries.push({ key, compiled: compileElements(pseudoMessage(parseMessage(english))) });
  }

  return entries;
}

/**
 * The locale modules one compile writes: what the features brought, and the pseudo-locale derived
 * from English on request.
 *
 * @param walk - What the walk collected.
 * @param pseudo - Whether the pseudo-locale is written too.
 * @returns The compiled messages per locale.
 */
function localeModules(walk: Walk, pseudo: boolean): Map<string, LocaleEntry[]> {
  const modules = new Map(walk.byLocale);

  if (pseudo) modules.set(PSEUDO_LOCALE, pseudoEntries(walk));

  return modules;
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

      notes.push(`the key "${key}" is missing from ${source.folder}/strings/${locale}.json.`);
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
 * Walks `features/*​/strings/<locale>.json` of a game and the `strings/` of every layer, compiles
 * every message and writes the generated modules: the types module `strings.ts` and one
 * `strings.<locale>.ts` per locale, plus `strings.en-XA.ts` with `pseudo`. A check run writes
 * nothing and only reports whether something would change; it checks `strings.en-XA.ts` only with
 * `pseudo`.
 *
 * @param root - Game source root, the folder that holds the features.
 * @param out - The generated directory the modules are written into.
 * @param options - Whether this is a check run, what the features folder is called, whether the
 *   pseudo-locale is written, and the layers.
 * @returns Whether an output differed, the locales, the keys and the notes.
 * @throws {Error} One error that lists every problem the compile found, the pseudo error when
 *   no feature or layer brings an `en` string file, or the layer error when a layer folder is not
 *   one folder name: nothing is read then.
 * @example
 * ```ts
 * // A dev build also writes the pseudo-locale, derived from the English messages.
 * const report = await compileStrings("src", "src/generated", { pseudo: true });
 * // report.locales: ["en", "en-XA", "ru"], report.changed: true on the first run
 * // A v15 game: features/board/strings/en.json { "board.full": "Full" } and the layer file
 * // shared/strings/en.json { "ui.ok": "OK" } compile together.
 * const layered = await compileStrings("src", "src/generated", { layers: { shared: "ui" } });
 * // layered.keys: ["board.full", "ui.ok"]
 * ```
 */
export async function compileStrings(
  root: string,
  out: string,
  options: CompileOptions = {}
): Promise<CompileReport> {
  const features = options.features ?? "features";
  const layers = options.layers ?? {};
  const pseudo = options.pseudo === true;

  // The pseudo-locale is derived from English: without it, refuse before reading a message.
  if (pseudo && !(await bringsLocale(root, features, layers, PSEUDO_SOURCE))) {
    throw pseudoNeedsEnglish();
  }

  // Collect every message of every feature and layer, and fail once with every problem found.
  const walk = await walkStrings(root, features, layers);

  if (walk.problems.length > 0) throw compileFailure(walk.problems);

  // Derive the locales and the keys. Without a locale there is nothing to emit.
  const brought = [...walk.byLocale.keys()].toSorted();
  const keys = [...walk.owner.keys()].toSorted();

  if (brought.length === 0) return { changed: false, locales: brought, keys, notes: [] };

  // Build the types module and one module per locale, the pseudo-locale included on request.
  const modules = localeModules(walk, pseudo);
  const locales = [...modules.keys()].toSorted();
  const write = options.check !== true;
  const outputs = [
    { file: path.join(out, "strings.ts"), text: emitTypes(typeEntries(walk)) },
    ...locales.map(locale => ({
      file: path.join(out, `strings.${locale}.ts`),
      text: emitLocale(modules.get(locale) ?? [])
    }))
  ];
  let changed = false;

  // Write the modules whose text changed. A check run writes nothing.
  for (const output of outputs) {
    changed = (await writeIfChanged(output.file, output.text, write)) || changed;
  }

  return { changed, locales, keys, notes: missingNotes(walk, brought) };
}

/**
 * Tells whether the generated modules of a game are current, without writing anything. The
 * `--check` run of `bun run assets:keys` covers the strings with it. It walks the features only: a
 * game with layers checks through `runCli` with `--check --layer …`.
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
