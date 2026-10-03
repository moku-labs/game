/**
 * @file visual — `runVisualTests`, the runner a game's script calls, and `parseVisualArgv`, its
 * command line. It resolves the options, selects the tests, runs the headless leg and then, with
 * `pixels` on, the browser leg, prints one line per checkpoint through the branded console of
 * `@moku-labs/common/cli` and answers one report. The game's script sets the exit code.
 */
import { createBrandConsole } from "@moku-labs/common/cli";
import { checkVisualTest } from "./define";
import { runBrowserLeg } from "./leg-browser";
import { runHeadlessLeg } from "./leg-headless";
import type {
  CheckpointResult,
  VisualFlags,
  VisualOptions,
  VisualReport,
  VisualRun,
  VisualSetup,
  VisualTest,
  VisualTestResult
} from "./types";

/** The folder of the visual tests, relative to where the script runs. */
const DEFAULT_DIR = "tests/visual";

/** The most frames a settle runs: ten seconds at 60 fps. */
const DEFAULT_SETTLE_FRAMES = 600;

/** A pixel differs above a channel delta of 24; one in a thousand may. */
const DEFAULT_TOLERANCE = { ratio: 0.001, threshold: 24 } as const;

/** The lines the runner writes: a `BrandConsole` fits. */
type ReportConsole = {
  check(ok: boolean, label: string): void;
  error(message: string): void;
};

/**
 * Reads the value after a flag that takes one.
 *
 * @param argv - The arguments.
 * @param index - The index of the flag.
 * @param placeholder - What the value is, for the message: `<name>`.
 * @returns The value.
 * @throws {Error} When the flag is last, or another flag follows it.
 */
function valueAfter(argv: readonly string[], index: number, placeholder: string): string {
  const value = argv[index + 1];

  if (value !== undefined && !value.startsWith("--")) return value;

  const flag = argv[index];

  throw new Error(`[game] The flag ${flag} needs a value.\n  Write it as ${flag} ${placeholder}.`);
}

/**
 * Reads the flags of the visual tests from a command line: `--update`, `--no-pixels`,
 * `--only <name>` (repeatable) and `--dir <path>`. An argument it does not know is left to the
 * script that got it, so a test runner's own arguments pass through.
 *
 * @param argv - The arguments after the script name.
 * @returns The flags that were given, and nothing else.
 * @throws {Error} When `--only` or `--dir` has no value.
 * @example
 * ```ts
 * // `bun tests/visual/run.ts --update --only reward-popup`
 * parseVisualArgv(["--update", "--only", "reward-popup"]); // { update: true, only: ["reward-popup"] }
 * parseVisualArgv(["--no-pixels", "--dir", "shots"]); // { pixels: false, dir: "shots" }
 * ```
 */
export function parseVisualArgv(argv: readonly string[]): VisualFlags {
  const flags: VisualFlags = {};
  const only: string[] = [];

  for (const [index, argument] of argv.entries()) {
    if (argument === "--update") flags.update = true;
    if (argument === "--no-pixels") flags.pixels = false;
    if (argument === "--only") only.push(valueAfter(argv, index, "<name>"));
    if (argument === "--dir") flags.dir = valueAfter(argv, index, "<path>");
  }

  return only.length === 0 ? flags : { ...flags, only };
}

/**
 * Fills in the options of a run: an explicit option wins over a flag of `argv`, a flag over the
 * default. `pixels` is on by default only with a `page` on a Mac.
 *
 * @param setup - The setup, for its `page`.
 * @param options - The options the script passed.
 * @returns The options with every default filled in.
 * @throws {Error} When a flag of `argv` misses its value.
 */
export function resolveVisualOptions(setup: VisualSetup, options: VisualOptions = {}): VisualRun {
  const flags = parseVisualArgv(options.argv ?? process.argv.slice(2));
  const only = options.only ?? flags.only;
  const run: VisualRun = {
    dir: options.dir ?? flags.dir ?? DEFAULT_DIR,
    update: options.update ?? flags.update ?? false,
    pixels:
      options.pixels ?? flags.pixels ?? (setup.page !== undefined && process.platform === "darwin"),
    settleFrames: options.settleFrames ?? DEFAULT_SETTLE_FRAMES,
    tolerance: options.tolerance ?? { ...DEFAULT_TOLERANCE }
  };

  return only === undefined ? run : { ...run, only };
}

/**
 * Picks the tests a run plays: all of them, or the ones `only` names, in the order given.
 *
 * @param tests - Every test of the script.
 * @param only - The names to run, if any.
 * @returns The selected tests.
 * @throws {Error} When a test is not well formed, two tests share a name, or `only` names no
 *   test.
 */
function selectTests(tests: readonly VisualTest[], only?: readonly string[]): VisualTest[] {
  for (const test of tests) checkVisualTest(test.name, test.steps);

  const names = tests.map(test => test.name);
  const twice = names.find((name, index) => names.indexOf(name) !== index);

  if (twice !== undefined) {
    throw new Error(
      `[game] Two visual tests are named "${twice}".\n  Give every visual test its own name.`
    );
  }

  const unknown = only?.find(name => !names.includes(name));

  if (unknown !== undefined) {
    throw new Error(
      `[game] No visual test is named "${unknown}".\n  Use one of: ${names.join(", ")}.`
    );
  }

  return only === undefined ? [...tests] : tests.filter(test => only.includes(test.name));
}

/**
 * Writes one comparison of a checkpoint for its line.
 *
 * @param kind - `state`, `describe` or `pixels`.
 * @param outcome - What the comparison found.
 * @param first - The path of the first difference, for `state` and `describe`.
 * @returns `state same`, or `state different at player.coins`.
 * @example
 * ```ts
 * outcomeText("state", "different", "player.coins"); // "state different at player.coins"
 * ```
 */
function outcomeText(kind: string, outcome: string, first?: string): string {
  return outcome === "different" && first !== undefined
    ? `${kind} ${outcome} at ${first}`
    : `${kind} ${outcome}`;
}

/**
 * Writes the pixel comparison of a checkpoint for its line: on a difference, the share of
 * differing pixels, or `at size`, and the verdict.
 *
 * @param result - The checkpoint's outcome.
 * @returns `pixels same`, or `pixels different 0.42% (rendering)`.
 * @example
 * ```ts
 * pixelText({ name: "open", state: "same", describe: "same", pixels: "different", pixelRatio: 0.0042, verdict: "rendering" });
 * // "pixels different 0.42% (rendering)"
 * ```
 */
function pixelText(result: CheckpointResult): string {
  if (result.pixels !== "different") return `pixels ${result.pixels}`;

  const share =
    result.pixelRatio === undefined ? "at size" : `${(result.pixelRatio * 100).toFixed(2)}%`;

  return `pixels different ${share} (${result.verdict ?? "behaviour"})`;
}

/**
 * Writes the line of one checkpoint. The first difference is the state's when the state
 * differs, the describe's otherwise.
 *
 * @param test - The test name.
 * @param result - The checkpoint's outcome.
 * @returns `reward-popup/open: state same · describe same · pixels skipped`.
 */
function checkpointLine(test: string, result: CheckpointResult): string {
  const stateFirst = result.state === "different" ? result.first : undefined;
  const describeFirst = result.state === "different" ? undefined : result.first;

  return [
    `${test}/${result.name}:`,
    outcomeText("state", result.state, stateFirst),
    "·",
    outcomeText("describe", result.describe, describeFirst),
    "·",
    pixelText(result)
  ].join(" ");
}

/**
 * Tells whether a checkpoint passed: no comparison found a difference.
 *
 * @param result - The checkpoint's outcome.
 * @returns True when nothing is `"different"`.
 */
function passed(result: CheckpointResult): boolean {
  return [result.state, result.describe, result.pixels].every(outcome => outcome !== "different");
}

/**
 * Prints one line per checkpoint, and the error of a test that ended early.
 *
 * @param ui - Where the lines go.
 * @param results - The results of the run.
 */
function printResults(ui: ReportConsole, results: readonly VisualTestResult[]): void {
  for (const result of results) {
    for (const checkpoint of result.checkpoints) {
      ui.check(passed(checkpoint), checkpointLine(result.name, checkpoint));
    }

    if (result.error !== undefined) ui.error(result.error);
  }
}

/**
 * Runs the browser leg after the headless one. When the leg fails as a whole, the lines of the
 * headless leg are printed before its error is thrown, so they are not lost.
 *
 * @param ui - Where the lines go.
 * @param setup - How to build a game, and the dev page.
 * @param tests - The selected tests.
 * @param run - The run options.
 * @param headless - The results of the headless leg.
 * @returns The results with their pixel fields.
 * @throws {Error} Whatever fails the browser leg.
 */
async function withPixelLeg(
  ui: ReportConsole,
  setup: VisualSetup,
  tests: readonly VisualTest[],
  run: VisualRun,
  headless: VisualTestResult[]
): Promise<VisualTestResult[]> {
  try {
    return await runBrowserLeg(setup, tests, run, headless);
  } catch (error) {
    printResults(ui, headless);

    throw error;
  }
}

/**
 * Runs visual tests: the headless leg over every selected test, then the browser leg over the
 * same tests when `pixels` is on (by default only with a `page` on a Mac). A checkpoint saves
 * `state.json` and `describe.json` in `<dir>/<test>/<checkpoint>/`, and the browser leg
 * `screen.webp`, lossless: a missing file is written, `--update` rewrites every file of the tests
 * run, a JSON file is compared exactly. The browser leg opens the dev page in Chrome with WebGPU
 * through `playwright-core`, pauses its game, plays each test there on stepped frames of 1000/60
 * ms, so two runs see the same game time, checks the page's state against `state.json` and
 * compares the picture in the page: a pixel differs above `tolerance.threshold`, and the screen
 * differs when more than `tolerance.ratio` of its pixels do; `screen.actual.webp` and
 * `screen.diff.webp` are written beside the baseline then. A pixel difference over the same state
 * and describe is a rendering regression (`verdict: "rendering"`). One line per checkpoint goes
 * to the branded console; the script sets the exit code from `ok`.
 *
 * @param setup - How to build a game: a fresh, unstarted app per test, and the dev page.
 * @param tests - Every visual test of the game.
 * @param options - Overrides of the flags of `argv` and of the defaults.
 * @returns The report: `ok` when no test failed and nothing is `"different"`.
 * @throws {Error} When a test is not well formed, two tests share a name, `only` names no test,
 *   a flag misses its value, or the browser leg fails as a whole: no `page`, no
 *   `playwright-core`, no Chrome, or a page that does not open, expose `game` and `doors`, start,
 *   draw with WebGPU or stop loading.
 * @example
 * ```ts
 * // tests/visual/run.ts of a game, `bun tests/visual/run.ts --update` on a Mac
 * const report = await runVisualTests(
 *   { app: () => createScreenGame().app, page: { url: "http://localhost:3000/" } },
 *   [rewardPopup]
 * );
 * report.tests[0]?.checkpoints[0]; // { name: "open", state: "written", describe: "written", pixels: "written" }
 * process.exitCode = report.ok ? 0 : 1;
 * ```
 */
export async function runVisualTests(
  setup: VisualSetup,
  tests: readonly VisualTest[],
  options: VisualOptions = {}
): Promise<VisualReport> {
  const run = resolveVisualOptions(setup, options);
  const selected = selectTests(tests, run.only);
  const ui = createBrandConsole();
  const headless = await runHeadlessLeg(setup, selected, run);
  const results = run.pixels ? await withPixelLeg(ui, setup, selected, run, headless) : headless;

  printResults(ui, results);

  const ok = results.every(
    result =>
      result.error === undefined && result.checkpoints.every(checkpoint => passed(checkpoint))
  );

  return { ok, tests: results };
}
