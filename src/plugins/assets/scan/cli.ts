/**
 * @file assets plugin, build time — the command line of the scanner, the packer and the string
 * tools. It is the only file here that touches the terminal: the scan, the emitters, the key rule
 * and the packer report back instead of printing. Output goes through the branded console of
 * `@moku-labs/common`, and `runCli` returns the exit code instead of taking it. The string tools
 * of i18n (compile, export, import) come in as a parameter: i18n sits above assets, so the door
 * `src/assets.ts` hands them over instead of this file importing them.
 */
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import type { Manifest, ManifestBundle } from "../types";
import { CACHE_FOLDER } from "./pack/cache";
import { type PackResult, packAssets } from "./pack/pack";
import { applyOutputs, scanAssets } from "./scan";

const MANIFEST_FILE = "manifest.json";

const KEYS_FILE = path.join("generated", "assets.ts");

/** The locale translators read from when `--source` names none. */
const DEFAULT_SOURCE = "en";

/** The extension of an exchange file: the export writes `<dir>/<locale>.json`. */
const EXCHANGE_EXTENSION = ".json";

/**
 * The part of the branded console the scanner writes through. A `BrandConsole` fits it, and a
 * test passes a recorder instead.
 */
export type ScanUi = {
  /** Writes one neutral line. */
  info(message: string): void;
  /** Writes one warning line. */
  warn(message: string): void;
  /** Writes one error line. */
  error(message: string, cause?: unknown): void;
};

/** What one strings compile reports back. `CompileReport` of i18n has this shape. */
export type StringsReport = {
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
 * Compiles the feature strings of a root into a folder, or checks them in a check run; with
 * `pseudo` it writes the pseudo-locale `en-XA` too, and with `layers` it walks the `strings/` of
 * every layer as well. `compileStrings` of i18n fits it, and a test passes a stub instead.
 *
 * @example
 * ```ts
 * // A test of a wrapper script: a game with one English key.
 * const compile: StringsCompiler = async () => ({ changed: false, locales: ["en"], keys: ["hud.title"], notes: [] });
 * // runCli passes { check: false, pseudo: true, layers: { shared: "ui" } } for "--pseudo --layer shared=ui"
 * ```
 */
export type StringsCompiler = (
  root: string,
  out: string,
  options: { check: boolean; pseudo: boolean; layers?: Readonly<Record<string, string>> }
) => Promise<StringsReport>;

/**
 * Writes one exchange file per locale for the translators into a folder, and reports how many
 * keys each locale lacks. `exportStrings` of i18n fits it, and a test passes a stub instead.
 *
 * @example
 * ```ts
 * // A test of a wrapper script: two locales, Russian three keys short.
 * const exportStub: StringsExporter = async () => ({ locales: ["en", "ru"], missing: { en: 0, ru: 3 } });
 * ```
 */
export type StringsExporter = (
  root: string,
  dir: string,
  options: { source: string; layers?: Readonly<Record<string, string>> }
) => Promise<{ locales: readonly string[]; missing: Readonly<Record<string, number>> }>;

/**
 * Takes the translated exchange files of a folder back into the string files of the features,
 * then compiles into `out`. It reports the totals of the run: the locales read, the keys written
 * and the feature files rewritten. `importStrings` of i18n fits it, and a test passes a stub.
 *
 * @example
 * ```ts
 * // A test of a wrapper script: the Russian file brought two hud texts.
 * const importStub: StringsImporter = async () => ({ locales: ["ru"], keys: 2, files: ["features/hud/strings/ru.json"] });
 * ```
 */
export type StringsImporter = (
  root: string,
  dir: string,
  options: {
    source: string;
    pseudo: boolean;
    out: string;
    layers?: Readonly<Record<string, string>>;
  }
) => Promise<{ locales: readonly string[]; keys: number; files: readonly string[] }>;

/**
 * The string tools of i18n the command line runs: the compile of every dev and pack run, the
 * export of `--export` and the import of `--import`. The door `src/assets.ts` passes the real
 * three.
 *
 * @example
 * ```ts
 * // src/assets.ts hands the i18n tools to the command line.
 * const strings: StringsTools = { compile: compileStrings, exportStrings, importStrings };
 * await runCli(["--root", "src", "--export", "translations"], strings); // 0
 * ```
 */
export type StringsTools = {
  compile: StringsCompiler;
  exportStrings: StringsExporter;
  importStrings: StringsImporter;
};

/** What one import reports back, as its console line reads it. */
type ImportTotals = Awaited<ReturnType<StringsImporter>>;

/** A layer map: folder under the root to the name its keys and bundles take. */
type Layers = Readonly<Record<string, string>>;

/** What the flags asked for. */
type Options = {
  root: string;
  manifest: string;
  keys: string;
  check: boolean;
  /** The pack folder of `--pack`, or `undefined` for a dev run. */
  pack: string | undefined;
  /** False after `--no-cache`. */
  cache: boolean;
  /** True after `--pseudo`: the compile writes the pseudo-locale `en-XA` too. */
  pseudo: boolean;
  /** The locale translators read from, `--source`. `"en"` by default. */
  source: string;
  /** The folder of `--export`, resolved, or `undefined`. */
  exportDir: string | undefined;
  /** The folder of `--import`, resolved, or `undefined`. */
  importDir: string | undefined;
  /** The layers of every `--layer`, folder to name. Empty by default. */
  layers: Layers;
};

/** The flags that take a value: a path, or the locale of `--source`. */
type ValueFlag =
  | "--root"
  | "--manifest"
  | "--keys"
  | "--pack"
  | "--export"
  | "--import"
  | "--source";

/** The flags that stand alone. */
type Switch = "--check" | "--no-cache" | "--pseudo";

/** The flags as they were given, before anything is resolved. */
type Flags = {
  values: Partial<Record<ValueFlag, string>>;
  switches: ReadonlySet<Switch>;
  /** The values of every `--layer`, in order: the one flag that repeats. */
  layers: readonly string[];
};

/** The flag that maps a folder under the root to the name its keys take. It repeats. */
const LAYER_FLAG = "--layer";

/**
 * Wraps a command line problem in the message shape of the framework.
 *
 * @param message - One sentence naming the option.
 * @returns The error to throw.
 */
function problem(message: string): Error {
  return new Error(`[game] assets: ${message}`);
}

/**
 * Reads the message of anything that was thrown.
 *
 * @param failure - What the `catch` caught.
 * @returns The message.
 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Tells whether an argument is one of the flags that take a value.
 *
 * @param flag - The argument.
 * @returns True for the path flags and `--source`.
 */
function isValueFlag(flag: string | undefined): flag is ValueFlag {
  return (
    flag === "--root" ||
    flag === "--manifest" ||
    flag === "--keys" ||
    flag === "--pack" ||
    flag === "--export" ||
    flag === "--import" ||
    flag === "--source"
  );
}

/**
 * Tells whether an argument is one of the flags that stand alone.
 *
 * @param flag - The argument.
 * @returns True for `--check`, `--no-cache` and `--pseudo`.
 */
function isSwitch(flag: string | undefined): flag is Switch {
  return flag === "--check" || flag === "--no-cache" || flag === "--pseudo";
}

/**
 * Reads the flags as they were given.
 *
 * @param argv - The arguments after the script name.
 * @returns The value of each flag that takes one, the switches and the `--layer` values.
 * @throws {Error} When an option is unknown or misses its value.
 */
function readFlags(argv: readonly string[]): Flags {
  const values: Partial<Record<ValueFlag, string>> = {};
  const switches = new Set<Switch>();
  const layers: string[] = [];
  let index = 0;

  while (index < argv.length) {
    const flag = argv[index];

    if (isSwitch(flag)) {
      switches.add(flag);
      index += 1;
      continue;
    }

    if (flag === LAYER_FLAG) {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw problem('"--layer" needs "<folder>[=<name>]".');
      }

      layers.push(value);
      index += 2;
      continue;
    }

    if (!isValueFlag(flag)) throw problem(`unknown option "${String(flag)}".`);

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw problem(`"${flag}" needs ${flag === "--source" ? "a locale" : "a path"}.`);
    }

    values[flag] = value;
    index += 2;
  }

  return { values, switches, layers };
}

/**
 * Reads the `--layer` values into the layer map. `shared=ui` maps the folder to the name,
 * `shared` alone maps it to itself. Only the syntax is checked here; the scan refuses a folder or
 * a name that cannot be a layer.
 *
 * @param raw - The values as given, in order.
 * @returns Folder to name.
 * @throws {Error} When a value has an empty side or a folder repeats.
 * @example
 * ```ts
 * parseLayers(["shared=ui", "common"]); // { shared: "ui", common: "common" }
 * ```
 */
function parseLayers(raw: readonly string[]): Record<string, string> {
  const layers = new Map<string, string>();

  for (const value of raw) {
    const cut = value.indexOf("=");
    const folder = cut === -1 ? value : value.slice(0, cut);
    const name = cut === -1 ? value : value.slice(cut + 1);

    if (folder === "" || name === "" || name.includes("=")) {
      throw problem(`"--layer ${value}" needs a folder and a name: "<folder>[=<name>]".`);
    }

    if (layers.has(folder)) throw problem(`"--layer" names the folder "${folder}" twice.`);

    layers.set(folder, name);
  }

  return Object.fromEntries(layers);
}

/**
 * The layer member of the options a tool is handed: none for a run without `--layer`, so such a
 * run calls every tool exactly as before layers existed.
 *
 * @param layers - The layers of the run.
 * @returns `{ layers }`, or an empty object when there is no layer.
 * @example
 * ```ts
 * withLayers({}); // {}
 * withLayers({ shared: "ui" }); // { layers: { shared: "ui" } }
 * ```
 */
function withLayers(layers: Layers): { layers?: Layers } {
  return Object.keys(layers).length === 0 ? {} : { layers };
}

/**
 * Refuses the flags that do not go together, before anything is read or written. An exchange
 * with the translators runs alone; only `--pseudo` may join an import, because the compile after
 * it writes the pseudo-locale too.
 *
 * @param flags - The flags as they were given.
 * @throws {Error} When two flags do not go together.
 */
function refuseConflicts(flags: Flags): void {
  const { values, switches } = flags;
  const exporting = values["--export"] !== undefined;
  const importing = values["--import"] !== undefined;
  const packing = values["--pack"] !== undefined;

  if (exporting || importing) {
    const joined =
      (exporting && importing) ||
      packing ||
      switches.has("--check") ||
      (exporting && switches.has("--pseudo"));

    if (joined) throw problem('"--export" and "--import" run alone; drop the other flags.');

    return;
  }

  if (values["--source"] !== undefined) {
    throw problem('"--source" goes with "--export" or "--import".');
  }

  if (packing && switches.has("--pseudo")) {
    throw problem('"--pseudo" is for a dev run; drop it from "--pack".');
  }

  if (packing && switches.has("--check")) throw problem('"--pack" writes files; drop "--check".');
}

/**
 * Resolves a folder flag against the working directory.
 *
 * @param given - The value of the flag, or `undefined` when it was not given.
 * @returns The absolute path, or `undefined`.
 */
function resolveGiven(given: string | undefined): string | undefined {
  return given === undefined ? undefined : path.resolve(given);
}

/**
 * Reads the flags. `--keys` defaults to `generated/assets.ts` inside the root; `--manifest` to
 * `manifest.json` inside the root, or inside the pack folder with `--pack`; `--source` to `"en"`.
 *
 * @param argv - The arguments after the script name.
 * @returns The resolved paths, the folders of the three modes, the switches and the layers.
 * @throws {Error} When an option is unknown, misses its value, does not go with another, or a
 *   `--layer` value is not `<folder>[=<name>]`.
 */
function parseArgv(argv: readonly string[]): Options {
  const flags = readFlags(argv);

  refuseConflicts(flags);

  const { values, switches } = flags;
  const root = path.resolve(values["--root"] ?? ".");
  const pack = resolveGiven(values["--pack"]);

  return {
    root,
    manifest: path.resolve(values["--manifest"] ?? path.join(pack ?? root, MANIFEST_FILE)),
    keys: path.resolve(values["--keys"] ?? path.join(root, KEYS_FILE)),
    check: switches.has("--check"),
    pack,
    cache: !switches.has("--no-cache"),
    pseudo: switches.has("--pseudo"),
    source: values["--source"] ?? DEFAULT_SOURCE,
    exportDir: resolveGiven(values["--export"]),
    importDir: resolveGiven(values["--import"]),
    layers: parseLayers(flags.layers)
  };
}

/**
 * Counts a thing in words, so the summary reads as a sentence.
 *
 * @param count - How many.
 * @param word - The singular.
 * @returns The count and the word.
 */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Sums up what the scan found, for the closing line.
 *
 * @param manifest - What the scan produced.
 * @returns The summary line.
 */
function summary(manifest: Manifest): string {
  const bundles = Object.values(manifest.bundles);
  let files = 0;
  let mb = 0;

  for (const bundle of bundles) {
    files += bundle.files.length;
    mb += bundle.mb;
  }

  return `${plural(bundles.length, "bundle")}, ${plural(files, "file")}, ${Math.round(mb * 1000) / 1000} MB of textures.`;
}

/**
 * Names both output files, for the lines about them.
 *
 * @param options - The resolved paths.
 * @returns The two paths in one phrase.
 */
function outputNames(options: Options): string {
  return `"${options.manifest}" and "${options.keys}"`;
}

/**
 * One line about the compiled strings.
 *
 * @param report - What the compile produced.
 * @returns The line for the console.
 * @example
 * ```ts
 * stringsSummary({ changed: false, locales: ["en", "ru"], keys: ["a", "b"], notes: [] }); // "2 strings in 2 locales (en, ru)."
 * ```
 */
function stringsSummary(report: StringsReport): string {
  return `${report.keys.length} strings in ${report.locales.length} locales (${report.locales.join(", ")}).`;
}

/**
 * One line about one exported locale: its file and how many keys it lacks.
 *
 * @param dir - The export folder, resolved.
 * @param locale - The locale of the file.
 * @param missing - How many keys have no text in that locale.
 * @returns The line for the console.
 * @example
 * ```ts
 * exportLine("/game/translations", "ru", 3); // 'exported "/game/translations/ru.json": 3 missing.'
 * ```
 */
function exportLine(dir: string, locale: string, missing: number): string {
  const file = path.join(dir, locale + EXCHANGE_EXTENSION);

  return `exported "${file}": ${missing} missing.`;
}

/**
 * One line about an import. The importer reports the totals of the run, so one line sums up
 * every locale: the folder, the locales read, the keys written and the feature files rewritten.
 *
 * @param dir - The import folder, resolved.
 * @param report - What the import wrote.
 * @returns The line for the console.
 * @example
 * ```ts
 * importLine("/game/translations", { locales: ["ru"], keys: 3, files: ["a.json", "b.json"] });
 * // 'imported "/game/translations" (ru): 3 keys into 2 files.'
 * ```
 */
function importLine(dir: string, report: ImportTotals): string {
  const locales = report.locales.length === 0 ? "" : ` (${report.locales.join(", ")})`;

  return (
    `imported "${dir}"${locales}: ` +
    `${plural(report.keys, "key")} into ${plural(report.files.length, "file")}.`
  );
}

/**
 * One line about a packed bundle.
 *
 * @param name - Name of the bundle.
 * @param bundle - The packed bundle.
 * @returns The line for the console.
 * @example
 * ```ts
 * bundleLine("orders", { feature: "orders", tier: "scene", mb: 0.253, files: [] });
 * // "packed orders: 0 pages, 0 loose, 0 fonts, 0 sounds, 0.253 MB"
 * ```
 */
function bundleLine(name: string, bundle: ManifestBundle): string {
  const pages = bundle.pages?.length ?? 0;
  const loose = bundle.files.filter(file => file.kind === undefined && file.path !== undefined);
  const fonts = bundle.files.filter(file => file.kind === "font").length;
  const sounds = bundle.files.filter(file => file.kind === "audio").length;

  return (
    `packed ${name}: ${plural(pages, "page")}, ${loose.length} loose, ` +
    `${plural(fonts, "font")}, ${plural(sounds, "sound")}, ${bundle.mb} MB`
  );
}

/**
 * The closing line of a pack: where the manifest went, what the folder holds and what the cache
 * gave.
 *
 * @param file - Path of the packed manifest.
 * @param result - What the pack wrote.
 * @param cache - False after `--no-cache`.
 * @returns The line for the console.
 */
function packSummary(file: string, result: PackResult, cache: boolean): string {
  const files = Object.values(result.manifest.bundles).flatMap(bundle => bundle.files);
  const fonts = files.filter(entry => entry.kind === "font").length;
  const sounds = files.filter(entry => entry.kind === "audio").length;
  const hits = cache ? `${result.cacheHits} of ${plural(result.pages, "page")}` : "off";

  return (
    `wrote "${file}": ${plural(result.pages, "page")}, ${plural(result.loose, "loose file")}, ` +
    `${plural(fonts, "font")}, ${plural(sounds, "sound")}, ${Math.round(result.bytes / 1024)} KB. ` +
    `cache: ${hits}.`
  );
}

/**
 * The dev run of `bun run assets:keys`: walk the features and the layers, write the manifest and
 * the key module, then compile the strings next to the key module (the pseudo-locale too with
 * `--pseudo`). With `--check` nothing is written and a difference fails the run.
 *
 * @param options - The parsed flags.
 * @param compile - The strings compiler.
 * @param ui - Where the lines go.
 * @returns The exit code: `1` when `--check` found a difference, else `0`.
 * @throws {Error} When the scan or the compile fails.
 */
async function runKeys(options: Options, compile: StringsCompiler, ui: ScanUi): Promise<number> {
  const { manifest, changed, notes } = await scanAssets({
    root: options.root,
    manifest: options.manifest,
    keys: options.keys,
    write: !options.check,
    ...withLayers(options.layers)
  });

  // The strings live next to the key module: one generated folder per game.
  const strings = await compile(options.root, path.dirname(options.keys), {
    check: options.check,
    pseudo: options.pseudo,
    ...withLayers(options.layers)
  });

  for (const note of [...notes, ...strings.notes]) ui.warn(note);

  if ((changed || strings.changed) && options.check) {
    ui.error(
      `${changed ? outputNames(options) : "the generated strings"} are out of date.\n` +
        '  Run "bun run assets:keys" and commit the result.'
    );

    return 1;
  }

  ui.info(changed ? `wrote ${outputNames(options)}.` : `${outputNames(options)} are up to date.`);
  ui.info(summary(manifest));
  if (strings.keys.length > 0) ui.info(stringsSummary(strings));

  return 0;
}

/**
 * The `--pack` run: the same scan and key list as a dev run, the strings compile, then the packer.
 * The keys are written as a dev run writes them; the dev manifest is not touched, the packed one
 * goes to `--manifest`.
 *
 * @param options - The parsed flags, with a pack folder.
 * @param pack - The pack folder.
 * @param compile - The strings compiler.
 * @param ui - Where the lines go.
 * @returns The exit code.
 * @throws {Error} When the scan, the compile or the pack fails.
 */
async function runPack(
  options: Options,
  pack: string,
  compile: StringsCompiler,
  ui: ScanUi
): Promise<number> {
  // A scan that writes nothing: the keys are written below, the manifest is the packer's.
  const scan = await scanAssets({
    root: options.root,
    manifest: options.manifest,
    keys: options.keys,
    write: false,
    ...withLayers(options.layers)
  });

  await applyOutputs([{ file: options.keys, text: scan.keysSource }], true);

  const strings = await compile(options.root, path.dirname(options.keys), {
    check: false,
    pseudo: false,
    ...withLayers(options.layers)
  });

  for (const note of [...scan.notes, ...strings.notes]) ui.warn(note);

  const result = await packAssets({
    root: options.root,
    manifest: scan.manifest,
    out: pack,
    manifestFile: options.manifest,
    cache: options.cache ? path.join(process.cwd(), CACHE_FOLDER) : false
  });

  for (const [name, bundle] of Object.entries(result.manifest.bundles)) {
    ui.info(bundleLine(name, bundle));
  }

  ui.info(packSummary(options.manifest, result, options.cache));

  return 0;
}

/**
 * The `--export <dir>` run: the exchange files for the translators and nothing else. No asset
 * scan, no generated module.
 *
 * @param options - The parsed flags.
 * @param dir - The export folder, resolved.
 * @param exportStrings - The strings exporter.
 * @param ui - Where the lines go.
 * @returns The exit code.
 * @throws {Error} When the export fails.
 */
async function runExport(
  options: Options,
  dir: string,
  exportStrings: StringsExporter,
  ui: ScanUi
): Promise<number> {
  const report = await exportStrings(options.root, dir, {
    source: options.source,
    ...withLayers(options.layers)
  });

  for (const locale of report.locales) {
    ui.info(exportLine(dir, locale, report.missing[locale] ?? 0));
  }

  return 0;
}

/**
 * The `--import <dir>` run: the translated files go into the feature string files, and the
 * importer compiles into the folder of the key module. No asset scan.
 *
 * @param options - The parsed flags.
 * @param dir - The import folder, resolved.
 * @param importStrings - The strings importer.
 * @param ui - Where the lines go.
 * @returns The exit code.
 * @throws {Error} When the import or its compile fails.
 */
async function runImport(
  options: Options,
  dir: string,
  importStrings: StringsImporter,
  ui: ScanUi
): Promise<number> {
  const report = await importStrings(options.root, dir, {
    source: options.source,
    pseudo: options.pseudo,
    out: path.dirname(options.keys),
    ...withLayers(options.layers)
  });

  ui.info(importLine(dir, report));

  return 0;
}

/**
 * Runs the asset key scanner: walk the features, write the manifest and the key module, then
 * compile the feature strings next to the key module, or check that all of it is current. With
 * `--pack <dir>` it packs the art for production on the same scan (`--no-cache` for a cold run);
 * `--pseudo` adds the pseudo-locale to a dev run. `--export <dir>` and `--import <dir>` exchange
 * the strings with translators and run alone, from the locale of `--source`.
 * `--layer <folder>[=<name>]` (repeatable) scans a folder under the root like one more feature,
 * its keys and bundles under `<name>` (`<folder>` by default); it goes with every mode. Nothing
 * here calls `process.exit`; the caller does.
 *
 * @param argv - The arguments after the script name.
 * @param strings - The string tools of i18n: compile, export and import.
 * @param ui - Where the lines go. The branded console by default.
 * @returns The exit code: `1` when the flags, the scan, the compile, the pack, the export or the
 *   import failed or `--check` found a difference, else `0`.
 * @example
 * ```ts
 * const strings = { compile: compileStrings, exportStrings, importStrings };
 * await runCli(["--root", "src", "--keys", "src/generated/assets.ts", "--pack", "dist/assets"], strings);
 * // 0, and dist/assets holds the pages, the loose files and the packed manifest.json
 * await runCli(["--root", "src", "--export", "translations"], strings);
 * // 0, and translations/ holds one <locale>.json per locale for the translators
 * await runCli(["--root", "src", "--layer", "shared=ui"], strings);
 * // 0, shared/assets/* keyed ui.*, shared/strings/* compiled
 * ```
 */
export async function runCli(
  argv: string[],
  strings: StringsTools,
  ui: ScanUi = createBrandConsole()
): Promise<number> {
  try {
    const options = parseArgv(argv);

    if (options.exportDir !== undefined) {
      return await runExport(options, options.exportDir, strings.exportStrings, ui);
    }

    if (options.importDir !== undefined) {
      return await runImport(options, options.importDir, strings.importStrings, ui);
    }

    if (options.pack !== undefined)
      return await runPack(options, options.pack, strings.compile, ui);

    return await runKeys(options, strings.compile, ui);
  } catch (error) {
    ui.error(messageOf(error));

    return 1;
  }
}
