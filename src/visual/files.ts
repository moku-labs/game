/**
 * @file visual — the baseline files next to the tests: `<dir>/<test>/<checkpoint>/state.json`,
 * `describe.json` and `screen.webp`, with `screen.actual.webp` and `screen.diff.webp` beside them
 * on a pixel difference. The pictures are lossless WebP, encoded in the page. The only module of
 * the runner that touches the disk, so `node:fs/promises` and `node:path` are imported here and
 * nowhere else; the `./testing` entry is node and bun only.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareJson, parseJson } from "./compare";
import type { Checked } from "./types";

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

/** What every picture of the leg starts with: the page encodes the capture as lossless WebP. */
const WEBP_URL = "data:image/webp;base64,";

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
 * Reads a baseline file as bytes.
 *
 * @param file - The path.
 * @returns Its bytes, or `undefined` when there is no such file.
 * @throws {Error} Any read error other than a missing file.
 */
async function readBytes(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissing(error)) return undefined;

    throw error;
  }
}

/**
 * Writes a baseline file, its folders included.
 *
 * @param file - The path.
 * @param data - The text or the bytes.
 */
async function writeBaseline(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

/**
 * Compares the text of a baseline file with what a checkpoint read, as JSON.
 *
 * @param file - The path of the baseline, for the message.
 * @param baseline - The text of the file.
 * @param text - What the checkpoint read, as `stableJson` wrote it.
 * @returns `"same"`, or `"different"` with the path of the first difference.
 * @throws {Error} When the baseline is not JSON.
 */
function compareText(file: string, baseline: string, text: string): Checked {
  const first = compareJson(parseJson(baseline, file), parseJson(text, file));

  return first === undefined ? { outcome: "same" } : { outcome: "different", first };
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
  const baseline = update ? undefined : await readBytes(file);

  if (baseline === undefined) {
    await writeBaseline(file, text);

    return { outcome: "written" };
  }

  return compareText(file, baseline.toString("utf8"), text);
}

/**
 * Compares what the page read with a baseline file the headless leg owns, and never writes it.
 * The browser leg checks `state.json` this way.
 *
 * @param file - The path of the baseline.
 * @param text - What the page read, as `stableJson` wrote it.
 * @returns The outcome, or `undefined` when there is no baseline to compare with.
 * @throws {Error} When the baseline is not JSON, or the disk refused.
 */
export async function compareBaseline(file: string, text: string): Promise<Checked | undefined> {
  const baseline = await readBytes(file);

  return baseline === undefined ? undefined : compareText(file, baseline.toString("utf8"), text);
}

/**
 * Reads a picture of a checkpoint, such as `screen.webp`, the way the page hands one over: a
 * WebP data URL.
 *
 * @param file - The path.
 * @returns The data URL, or `undefined` when there is no such file.
 * @throws {Error} Any read error other than a missing file.
 */
export async function readScreen(file: string): Promise<string | undefined> {
  const bytes = await readBytes(file);

  return bytes === undefined ? undefined : `${WEBP_URL}${bytes.toString("base64")}`;
}

/**
 * Writes a picture of a checkpoint: the bytes of the lossless WebP data URL the page encoded, its
 * folders included.
 *
 * @param file - The path: `screen.webp`, `screen.actual.webp` or `screen.diff.webp`.
 * @param url - The WebP data URL.
 * @throws {Error} When the URL is not a WebP data URL, or the disk refused.
 */
export async function writeScreen(file: string, url: string): Promise<void> {
  if (!url.startsWith(WEBP_URL)) {
    throw new Error(
      "[game] The page gave a picture that is not a WebP data URL.\n  Run the pixel leg in Chrome: the baselines are lossless WebP."
    );
  }

  await writeBaseline(file, Buffer.from(url.slice(WEBP_URL.length), "base64"));
}
