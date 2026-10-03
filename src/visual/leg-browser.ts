/**
 * @file visual — the browser leg: Chrome with WebGPU on a Mac, driven by Playwright. It loads
 * `playwright-core` with a dynamic import only here, opens the dev page once per test, plays the
 * test inside the page through `globalThis.game` and `globalThis.doors`, and at each checkpoint
 * checks the page's state against `state.json` and its picture against `screen.png`. The pixels
 * are compared in the page (`page-script.ts`); the files are written by `files.ts`. A failure of
 * the page itself fails the leg; a failure of a step ends its test only.
 */
import type { RendererKind } from "../plugins/renderer/types";
import { stableJson } from "./compare";
import { baselineFile, compareBaseline, readScreen, writeScreen } from "./files";
import { messageOf, reasonOf, stepFailure } from "./leg-headless";
import type { PageAnswer, PageCompared } from "./page-script";
import {
  pageCheckpoint,
  pageCompare,
  pageReady,
  pageScript,
  pageStart,
  pageStep
} from "./page-script";
import { stepEntry } from "./steps";
import type {
  CheckpointResult,
  ChromeBrowser,
  ChromeContext,
  ChromePage,
  Chromium,
  ContextOptions,
  LaunchOptions,
  PixelCheck,
  PixelFound,
  VisualPage,
  VisualRun,
  VisualSetup,
  VisualTest,
  VisualTestResult,
  VisualTolerance
} from "./types";

/** The Chrome flags of `.planning/e2e/run.mjs`: WebGPU on Metal, on any GPU. */
const WEBGPU_FLAGS = [
  "--enable-unsafe-webgpu",
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist"
] as const;

/** The page width in CSS px when the setup names none: a phone. */
const DEFAULT_WIDTH = 390;

/** The device scale when the setup names none. */
const DEFAULT_SCALE = 2;

/** How long the page may take to expose `game` and `doors`, in milliseconds. */
const READY_MS = 15_000;

/** What one test plays on: its page, the test and the run options. */
type Play = { page: ChromePage; test: VisualTest; run: VisualRun };

/** A launch that worked, or the first line of why it did not. */
type Attempt = { browser: ChromeBrowser } | { reason: string };

/**
 * Reads the first line of a Playwright error, without the name of the call that failed.
 *
 * @param error - What Playwright threw.
 * @returns The line, without a final period.
 * @example
 * ```ts
 * firstLine(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/\nCall log:")); // "net::ERR_CONNECTION_REFUSED at http://localhost:3000/"
 * ```
 */
function firstLine(error: unknown): string {
  const [line = ""] = messageOf(error).split("\n");

  return line.replace(/^[\w.]+: /u, "").replace(/\.$/u, "");
}

/**
 * Loads `chromium` from `playwright-core`, the optional peer, with a dynamic import: the package
 * never reaches a bundle that does not run the pixel leg.
 *
 * @returns The `chromium` of Playwright.
 * @throws {Error} When `playwright-core` is not installed.
 */
export async function loadChromium(): Promise<Chromium> {
  try {
    const playwright = await import("playwright-core");

    return playwright.chromium;
  } catch {
    throw new Error(
      "[game] The pixel leg needs playwright-core.\n  Add it: bun add -d playwright-core, or run with --no-pixels."
    );
  }
}

/**
 * Launches one Chrome, keeping why it did not start.
 *
 * @param chromium - The `chromium` of Playwright.
 * @param options - The launch options.
 * @returns The browser, or the reason.
 */
async function attempt(chromium: Chromium, options: LaunchOptions): Promise<Attempt> {
  try {
    return { browser: await chromium.launch(options) };
  } catch (error) {
    return { reason: firstLine(error) };
  }
}

/**
 * Launches Chrome with the four WebGPU flags: the Chrome of `page.browser` when the setup names
 * one, else Playwright's own Chromium, else the system Chrome. Playwright's Chromium comes first
 * because its version is pinned by `playwright-core`, so the baselines do not move with a Chrome
 * update.
 *
 * @param chromium - The `chromium` of Playwright.
 * @param browser - The `browser` of the page, if any.
 * @returns The browser.
 * @throws {Error} When the named Chrome, or every default one, does not launch.
 */
export async function launchChrome(
  chromium: Chromium,
  browser: VisualPage["browser"]
): Promise<ChromeBrowser> {
  const args = [...WEBGPU_FLAGS];

  if (browser !== undefined) {
    const given = await attempt(chromium, { ...browser, args });

    if ("browser" in given) return given.browser;

    throw new Error(
      `[game] Chrome did not launch from page.browser: ${given.reason}.\n  Fix page.browser, or run with --no-pixels.`
    );
  }

  const own = await attempt(chromium, { args });

  if ("browser" in own) return own.browser;

  const system = await attempt(chromium, { channel: "chrome", args });

  if ("browser" in system) return system.browser;

  throw new Error(
    `[game] No Chrome launched: ${own.reason}.\n  Install Playwright's Chromium (bunx playwright-core install chromium), set page.browser, or run with --no-pixels.`
  );
}

/**
 * Sizes the page: `page.width` CSS px wide (390), as tall as the inert frame of the game is at
 * that width, so the reference frame of the page equals the one of the headless leg; a phone
 * with touch at `page.deviceScaleFactor` (2). Builds one app of the setup, never started, to read
 * its inert frame.
 *
 * @param setup - The setup, for a fresh app.
 * @param page - The page.
 * @returns The options of the browser context.
 */
export function pageSize(setup: VisualSetup, page: VisualPage): ContextOptions {
  const width = page.width ?? DEFAULT_WIDTH;
  const frame = setup.app().renderer.viewport.size();

  return {
    viewport: { width, height: Math.round((width * frame.height) / frame.width) },
    deviceScaleFactor: page.deviceScaleFactor ?? DEFAULT_SCALE,
    isMobile: true,
    hasTouch: true
  };
}

/**
 * Decides the pixel outcome of a checkpoint: two sizes are `"different"` at `"size"`; else the
 * share of differing pixels is `"different"` over `tolerance.ratio`, `"same"` at or under it.
 *
 * @param compared - What the page counted.
 * @param tolerance - The tolerance of the run.
 * @returns The outcome, with `pixelRatio` or `first` on a difference.
 * @example
 * ```ts
 * pixelOutcome({ sameSize: true, differing: 2, total: 1000 }, { ratio: 0.001, threshold: 24 }); // { outcome: "different", pixelRatio: 0.002 }
 * ```
 */
export function pixelOutcome(compared: PageCompared, tolerance: VisualTolerance): PixelCheck {
  if (!compared.sameSize) return { outcome: "different", first: "size" };

  const pixelRatio = compared.differing / compared.total;

  return pixelRatio > tolerance.ratio ? { outcome: "different", pixelRatio } : { outcome: "same" };
}

/**
 * Adds what the browser leg found to the checkpoint result of the headless leg. A state the page
 * reached differently is a state difference. `first` stays the state's before the describe's,
 * then names `"size"`. A pixel difference gets a verdict: `"rendering"` when the state and the
 * describe were the same in this run, the regression a renderer change makes, `"behaviour"`
 * otherwise.
 *
 * @param result - The checkpoint result of the headless leg.
 * @param found - What the browser leg found there.
 * @returns The checkpoint result with its pixel fields.
 * @example
 * ```ts
 * const headless = { name: "open", state: "same", describe: "same", pixels: "skipped" } as const;
 * withPixels(headless, { state: { outcome: "same" }, pixels: { outcome: "different", pixelRatio: 0.004 } });
 * // { name: "open", state: "same", describe: "same", pixels: "different", pixelRatio: 0.004, verdict: "rendering" }
 * ```
 */
export function withPixels(result: CheckpointResult, found: PixelFound): CheckpointResult {
  const pageDiffers = found.state?.outcome === "different";
  const state = pageDiffers ? "different" : result.state;
  const stateFirst = result.state === "different" ? result.first : found.state?.first;
  const describeFirst = result.state === "different" ? undefined : result.first;
  const first = stateFirst ?? describeFirst ?? found.pixels.first;
  const merged: CheckpointResult = {
    name: result.name,
    state,
    describe: result.describe,
    pixels: found.pixels.outcome
  };

  if (first !== undefined) merged.first = first;

  if (found.pixels.outcome !== "different") return merged;

  if (found.pixels.pixelRatio !== undefined) merged.pixelRatio = found.pixels.pixelRatio;

  merged.verdict = state === "same" && result.describe === "same" ? "rendering" : "behaviour";

  return merged;
}

/**
 * Runs one page function and takes its answer. A page that breaks, and a failure the function
 * answered as a reason, become the error of the step; a whole message is thrown as it is.
 *
 * @param page - The page.
 * @param fn - The page function.
 * @param argument - Its argument, with the test and the step.
 * @returns The value the function answered.
 * @throws {Error} When the page broke or the function failed.
 */
async function callPage<A extends { test: string; where: string }, T>(
  page: ChromePage,
  fn: (argument: A) => Promise<PageAnswer<T>>,
  argument: A
): Promise<T> {
  const answer = await page.evaluate(fn, argument).catch((error: unknown) => {
    throw stepFailure(argument.test, argument.where, firstLine(error));
  });

  if (answer.ok) return answer.value;

  throw "error" in answer
    ? new Error(answer.error)
    : stepFailure(argument.test, argument.where, answer.reason);
}

/**
 * Waits in the page for its graph to rest at its first gate, and reads the renderer kind.
 *
 * @param page - The page, its handles exposed.
 * @param url - The URL of the dev page, for the message.
 * @param run - The run options, for `settleFrames`.
 * @returns The renderer kind.
 * @throws {Error} When the graph does not rest at a gate, or the page breaks.
 */
async function startPage(page: ChromePage, url: string, run: VisualRun): Promise<RendererKind> {
  const settleFrames = run.settleFrames;
  const started = await page
    .evaluate(pageStart, { url, settleFrames })
    .catch((error: unknown) => ({ ok: false, reason: firstLine(error) }) as const);

  if (started.ok) return started.value;

  throw new Error(
    "error" in started
      ? started.error
      : `[game] The page at ${url} did not start.\n  ${reasonOf(started.reason)}`
  );
}

/**
 * Opens the dev page for one test: the page script first, then the URL, then the wait for
 * `game` and `doors`, for the graph at its first gate, and the check that it draws with WebGPU.
 *
 * @param context - The browser context.
 * @param url - The URL of the dev page.
 * @param run - The run options, for `settleFrames`.
 * @returns The open page.
 * @throws {Error} When the page does not open, never exposes `game` and `doors`, does not start
 *   or does not draw with WebGPU. The page is closed then.
 */
async function openPage(context: ChromeContext, url: string, run: VisualRun): Promise<ChromePage> {
  const page = await context.newPage();

  try {
    await page.addInitScript({ content: pageScript() });
    await page.goto(url).catch((error: unknown) => {
      throw new Error(
        `[game] The page at ${url} did not open: ${firstLine(error)}.\n  Serve the dev page (bun ./web/serve.ts), or run with --no-pixels.`
      );
    });
    await page.waitForFunction(pageReady, undefined, { timeout: READY_MS }).catch(() => {
      throw new Error(
        `[game] The page at ${url} exposes no game and doors.\n  Serve the dev page (bun ./web/serve.ts) and set globalThis.game and globalThis.doors in it.`
      );
    });

    const kind = await startPage(page, url, run);

    if (kind !== "webgpu") {
      throw new Error(
        `[game] The page at ${url} draws with ${kind}, not WebGPU.\n  The pixel baselines are WebGPU only: use a Chrome with WebGPU on a Mac, or run with --no-pixels.`
      );
    }

    return page;
  } catch (error) {
    await page.close();

    throw error;
  }
}

/**
 * Checks the picture of a checkpoint against `screen.png`: a missing baseline, or `--update`,
 * writes it; a difference writes `screen.actual.png`, and `screen.diff.png` when the sizes match.
 *
 * @param play - The test being played.
 * @param file - Names a file of the checkpoint.
 * @param where - The step, for the message.
 * @param screen - The picture the page took.
 * @returns The pixel outcome.
 */
async function checkScreen(
  play: Play,
  file: (name: string) => string,
  where: string,
  screen: string
): Promise<PixelCheck> {
  const { run } = play;
  const baseline = run.update ? undefined : await readScreen(file("screen.png"));

  if (baseline === undefined) {
    await writeScreen(file("screen.png"), screen);

    return { outcome: "written" };
  }

  const compared = await callPage(play.page, pageCompare, {
    test: play.test.name,
    where,
    expected: baseline,
    actual: screen,
    threshold: run.tolerance.threshold
  });
  const found = pixelOutcome(compared, run.tolerance);

  if (found.outcome === "different") {
    await writeScreen(file("screen.actual.png"), screen);

    if (compared.diff !== undefined) await writeScreen(file("screen.diff.png"), compared.diff);
  }

  return found;
}

/**
 * Plays a checkpoint in the page and checks what it found: the state against `state.json` the
 * headless leg wrote, the picture against `screen.png`.
 *
 * @param play - The test being played.
 * @param name - The checkpoint name.
 * @param where - The step, for the message.
 * @returns What the browser leg found there.
 * @throws {Error} When the page did not settle, gave no picture, or broke.
 */
async function checkpoint(play: Play, name: string, where: string): Promise<PixelFound> {
  const { test, run } = play;
  const shot = await callPage(play.page, pageCheckpoint, {
    test: test.name,
    where,
    settleFrames: run.settleFrames
  });

  if (shot.screen === undefined) {
    throw new Error(
      `[game] Visual test "${test.name}", ${where}: the page gave no picture.\n  Serve a dev build with WebGPU: renderer.capture() answers only there.`
    );
  }

  const file = (kind: string): string => baselineFile(run.dir, test.name, name, kind);
  const state = await compareBaseline(file("state.json"), stableJson(shot.state));

  return { state, pixels: await checkScreen(play, file, where, shot.screen) };
}

/**
 * Plays the start and the steps of a test in the open page, the way the headless leg does:
 * restore the start, run each command and settle, and check each checkpoint.
 *
 * @param play - The test being played.
 * @param found - Where what each checkpoint found goes, as soon as it is known.
 */
async function playSteps(play: Play, found: Map<string, PixelFound>): Promise<void> {
  const { test, run } = play;
  const repro = { ...test.start, route: [] };
  const base = { test: test.name, settleFrames: run.settleFrames };

  await callPage(play.page, pageStep, {
    ...base,
    where: "the start",
    name: "restore",
    input: { repro }
  });

  for (const [index, step] of test.steps.entries()) {
    const entry = stepEntry(test.name, step, index);
    const where = `step ${index + 1} (${entry.kind === "checkpoint" ? "checkpoint" : entry.name})`;

    if (entry.kind === "checkpoint") {
      found.set(entry.name, await checkpoint(play, entry.name, where));
      continue;
    }

    await callPage(play.page, pageStep, { ...base, where, name: entry.name, input: entry.input });
  }
}

/**
 * Plays one test in a page of its own and adds the pixel fields to its headless result. A test
 * that fails keeps what the checkpoints it reached found, and carries the error.
 *
 * @param context - The browser context.
 * @param play - The test and the run options; the page is opened here.
 * @param play.test - The test.
 * @param play.run - The run options.
 * @param url - The URL of the dev page.
 * @param headless - The result of the test in the headless leg.
 * @returns The result of the test with its pixel fields.
 * @throws {Error} When the page fails to open: that fails the leg.
 */
async function browserTest(
  context: ChromeContext,
  play: Omit<Play, "page">,
  url: string,
  headless: VisualTestResult
): Promise<VisualTestResult> {
  const page = await openPage(context, url, play.run);
  const found = new Map<string, PixelFound>();
  let failed: string | undefined;

  try {
    await playSteps({ ...play, page }, found);
  } catch (error) {
    failed = messageOf(error);
  } finally {
    await page.close();
  }

  const checkpoints = headless.checkpoints.map(result => {
    const there = found.get(result.name);

    return there === undefined ? result : withPixels(result, there);
  });

  return failed === undefined
    ? { name: headless.name, checkpoints }
    : { name: headless.name, checkpoints, error: failed };
}

/**
 * Runs the browser leg over the tests the headless leg played, one page per test, and answers
 * their results with the pixel fields. A test the headless leg failed is left as it is. The
 * browser closes at the end, also after an error.
 *
 * @param setup - The setup: its `page`, and its app for the size of the page.
 * @param tests - The selected tests.
 * @param run - The run options.
 * @param headless - The results of the headless leg, in the order of `tests`.
 * @param load - Loads `chromium`; `playwright-core` by default.
 * @returns One result per test, in order.
 * @throws {Error} When the setup has no page, `playwright-core` or Chrome is missing, or the page
 *   does not open, expose `game` and `doors`, start, or draw with WebGPU.
 */
export async function runBrowserLeg(
  setup: VisualSetup,
  tests: readonly VisualTest[],
  run: VisualRun,
  headless: readonly VisualTestResult[],
  load: () => Promise<Chromium> = loadChromium
): Promise<VisualTestResult[]> {
  const page = setup.page;

  if (page === undefined) {
    throw new Error(
      "[game] The pixel leg needs the dev page.\n  Pass page: { url } in the setup, or run with --no-pixels."
    );
  }

  const chromium = await load();
  const options = pageSize(setup, page);
  const browser = await launchChrome(chromium, page.browser);

  try {
    const context = await browser.newContext(options);
    const results: VisualTestResult[] = [];

    for (const test of tests) {
      const before = headless.find(result => result.name === test.name) ?? {
        name: test.name,
        checkpoints: []
      };

      results.push(
        before.error === undefined
          ? await browserTest(context, { test, run }, page.url, before)
          : before
      );
    }

    return results;
  } finally {
    await browser.close();
  }
}
