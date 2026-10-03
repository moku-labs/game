/**
 * @file visual — the baseline files next to the tests: `<dir>/<test>/<checkpoint>/state.json` and
 * `describe.json`. The only module of the runner that touches the disk, so `node:fs/promises`
 * and `node:path` are imported here and nowhere else; the `./testing` entry is node and bun only.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareJson, parseJson } from "./compare";
import type { Outcome } from "./types";

/** What a comparison with one baseline file found, and where the first difference is. */
type Checked = { outcome: Outcome; first?: string };

/**
 * Names a baseline file of a checkpoint.
 *
 * @param dir - The folder of the visual tests, `"tests/visual"` by default.
 * @param test - The test name.
 * @param checkpoint - The checkpoint name.
 * @param file - The file name, such as `"state.json"`.
 * @returns The path.
 * @example
 * ```ts
 * baselineFile("tests/visual", "reward-popup", "open", "state.json"); // "tests/visual/reward-popup/open/state.json"
 * ```
 */
export function baselineFile(dir: string, test: string, checkpoint: string, file: string): string {
  return path.join(dir, test, checkpoint, file);
}

/**
 * Tells a missing file from the other errors of a read.
 *
 * @param error - What the read threw.
 * @returns True when the file does not exist.
 */
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Reads a baseline file.
 *
 * @param file - The path.
 * @returns Its text, or `undefined` when there is no such file.
 * @throws {Error} Any read error other than a missing file.
 */
async function readBaseline(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;

    throw error;
  }
}

/**
 * Writes a baseline file, its folders included.
 *
 * @param file - The path.
 * @param text - The text.
 */
async function writeBaseline(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/**
 * Compares what a checkpoint read with its baseline file. A missing file is written and
 * answered `"written"`, never a failure; `update` rewrites the file whatever it holds. A
 * difference leaves the baseline as it is.
 *
 * @param file - The path of the baseline.
 * @param text - What the checkpoint read, as `stableJson` wrote it.
 * @param update - Whether to rewrite the baseline.
 * @returns The outcome, and the path of the first difference for `"different"`.
 * @throws {Error} When the baseline is not JSON, or the disk refused.
 */
export async function checkBaseline(file: string, text: string, update: boolean): Promise<Checked> {
  const baseline = update ? undefined : await readBaseline(file);

  if (baseline === undefined) {
    await writeBaseline(file, text);

    return { outcome: "written" };
  }

  const first = compareJson(parseJson(baseline, file), parseJson(text, file));

  return first === undefined ? { outcome: "same" } : { outcome: "different", first };
}
