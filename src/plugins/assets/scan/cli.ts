/**
 * @file assets plugin, build time — the command line of the scanner. It is the only file here
 * that touches the terminal: the scan, the emitters and the key rule are pure. Output goes
 * through the branded console of `@moku-labs/common`, and `runCli` returns the exit code
 * instead of taking it.
 */
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import type { Manifest } from "../types";
import { scanAssets } from "./scan";

const MANIFEST_FILE = "manifest.json";

const KEYS_FILE = path.join("generated", "assets.ts");

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
type Options = { root: string; manifest: string; keys: string; check: boolean };

/** The flags that take a path. */
type PathFlag = "--root" | "--manifest" | "--keys";

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
 * Tells whether an argument is one of the flags that take a path.
 *
 * @param flag - The argument.
 * @returns True for `--root`, `--manifest` and `--keys`.
 */
function isPathFlag(flag: string | undefined): flag is PathFlag {
  return flag === "--root" || flag === "--manifest" || flag === "--keys";
}

/**
 * Reads the flags. `--manifest` and `--keys` default to `manifest.json` and `generated/assets.ts`
 * inside the root.
 *
 * @param argv - The arguments after the script name.
 * @returns The resolved paths and whether this is a check run.
 * @throws {Error} When an option is unknown or misses its value.
 */
function parseArgv(argv: readonly string[]): Options {
  const given: Record<PathFlag, string | undefined> = {
    "--root": undefined,
    "--manifest": undefined,
    "--keys": undefined
  };
  let check = false;
  let index = 0;

  while (index < argv.length) {
    const flag = argv[index];

    if (flag === "--check") {
      check = true;
      index += 1;
      continue;
    }

    if (!isPathFlag(flag)) throw problem(`unknown option "${String(flag)}".`);

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) throw problem(`"${flag}" needs a path.`);

    given[flag] = value;
    index += 2;
  }

  const root = path.resolve(given["--root"] ?? ".");

  return {
    root,
    manifest: path.resolve(given["--manifest"] ?? path.join(root, MANIFEST_FILE)),
    keys: path.resolve(given["--keys"] ?? path.join(root, KEYS_FILE)),
    check
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
 * Runs the asset key scanner: walk the features, write the manifest and the key module, or check
 * that both are current. Nothing here calls `process.exit`; the caller does.
 *
 * @param argv - The arguments after the script name.
 * @param ui - Where the lines go. The branded console by default.
 * @returns The exit code: `1` when the scan failed or `--check` found a difference, else `0`.
 * @example
 * ```ts
 * await runCli(["--root", "src", "--manifest", "public/assets/manifest.json", "--check"]);
 * // 1 when public/assets/manifest.json is older than the files in src/features
 * ```
 */
export async function runCli(argv: string[], ui: ScanUi = createBrandConsole()): Promise<number> {
  try {
    const options = parseArgv(argv);
    const { manifest, changed, notes } = await scanAssets({
      root: options.root,
      manifest: options.manifest,
      keys: options.keys,
      write: !options.check
    });

    for (const note of notes) ui.warn(note);

    if (changed && options.check) {
      ui.error(
        `${outputNames(options)} are out of date.\n` +
          '  Run "bun run assets:keys" and commit the result.'
      );

      return 1;
    }

    ui.info(changed ? `wrote ${outputNames(options)}.` : `${outputNames(options)} are up to date.`);
    ui.info(summary(manifest));

    return 0;
  } catch (error) {
    ui.error(messageOf(error));

    return 1;
  }
}
