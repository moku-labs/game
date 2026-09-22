/**
 * @file assets plugin, build time — the command line of the scanner. It is the only file here
 * that touches the terminal: the scan and the two emitters are pure. Output goes through the
 * branded console of `@moku-labs/common`, and `main` returns the exit code instead of taking it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import type { Manifest } from "../types";
import { emitKeys, emitManifest } from "./emit";
import { scanFeatures } from "./scan";

const MANIFEST_FILE = "manifest.json";

const KEYS_FILE = "generated/assets.ts";

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

/** What the flags asked for. */
type Options = { root: string; out: string; check: boolean };

/** One output file: where it goes and what it should contain. */
type Output = { name: string; text: string };

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
 * Reads the flags.
 *
 * @param argv - The arguments after the script name.
 * @returns The resolved folders and whether this is a check run.
 * @throws {Error} When an option is unknown or misses its value.
 */
function parseArgv(argv: readonly string[]): Options {
  let root = ".";
  let out: string | undefined;
  let check = false;
  let index = 0;

  while (index < argv.length) {
    const flag = argv[index];

    if (flag === "--check") {
      check = true;
      index += 1;
      continue;
    }

    if (flag !== "--root" && flag !== "--out") throw problem(`unknown option "${String(flag)}".`);

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) throw problem(`"${flag}" needs a folder.`);
    if (flag === "--root") root = value;
    else out = value;

    index += 2;
  }

  return { root: path.resolve(root), out: path.resolve(out ?? root), check };
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
 * Reads a file that may not exist yet.
 *
 * @param file - Absolute path of the file.
 * @returns Its text, or `undefined` when it is not there.
 */
async function readCurrent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Writes the outputs that would change, or lists them when this is a check run.
 *
 * @param options - The resolved folders and the check flag.
 * @param outputs - The two output files.
 * @param ui - Where the lines go.
 * @returns The exit code.
 */
async function apply(options: Options, outputs: readonly Output[], ui: ScanUi): Promise<number> {
  const stale: string[] = [];

  for (const output of outputs) {
    const file = path.join(options.out, ...output.name.split("/"));

    if ((await readCurrent(file)) === output.text) continue;

    stale.push(output.name);

    if (options.check) continue;

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, output.text);
    ui.info(`wrote "${output.name}".`);
  }

  if (stale.length === 0) {
    ui.info(`${outputs.map(output => output.name).join(" and ")} are up to date.`);

    return 0;
  }

  if (!options.check) return 0;

  ui.error(
    `${stale.join(" and ")} would change.\n  Run "bun run assets:keys" and commit the result.`
  );

  return 1;
}

/**
 * Runs the asset key scanner: walk the features, write `manifest.json` and `generated/assets.ts`,
 * or check that both are current. Nothing here calls `process.exit`; the caller does.
 *
 * @param argv - The arguments after the script name.
 * @param ui - Where the lines go. The branded console by default.
 * @returns The exit code: `1` when the scan failed or `--check` found a difference, else `0`.
 * @example
 * ```ts
 * await main(["--root", "src", "--out", "public/assets", "--check"]);
 * // 1 when manifest.json is older than the files in src/features
 * ```
 */
export async function main(argv: string[], ui: ScanUi = createBrandConsole()): Promise<number> {
  try {
    const options = parseArgv(argv);
    const { manifest, notes } = await scanFeatures(options.root);

    for (const note of notes) ui.warn(note);

    const code = await apply(
      options,
      [
        { name: MANIFEST_FILE, text: emitManifest(manifest) },
        { name: KEYS_FILE, text: emitKeys(manifest) }
      ],
      ui
    );

    if (code === 0) ui.info(summary(manifest));

    return code;
  } catch (error) {
    ui.error(messageOf(error));

    return 1;
  }
}
