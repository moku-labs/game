import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "../../../src/plugins/flow/doors/commands";
import { read } from "../../../src/plugins/flow/doors/read";
import { run } from "../../../src/plugins/flow/doors/run";
import { sources } from "../../../src/plugins/flow/doors/sources";
import { stableJson } from "../../../src/visual/compare";
import { defineVisualTest } from "../../../src/visual/define";
import {
  launchChrome,
  loadChromium,
  pageSize,
  pixelOutcome,
  runBrowserLeg,
  withPixels
} from "../../../src/visual/leg-browser";
import { runHeadlessLeg } from "../../../src/visual/leg-headless";
import { pageScript, pageStep } from "../../../src/visual/page-script";
import { resolveVisualOptions } from "../../../src/visual/run";
import type {
  CheckpointResult,
  Chromium,
  VisualOptions,
  VisualSetup,
  VisualTest,
  VisualTestResult
} from "../../../src/visual/types";
import { createTinyGame } from "./game";
import {
  type BrowserFaults,
  fakeChromium,
  installCodec,
  pictureOf,
  pngOf,
  startPageGame
} from "./page";

// ---------------------------------------------------------------------------
// Unit (no browser): the pure parts of the pixel leg — the tolerance, the
// verdict, the launch, the page size — and the leg itself on a fake chromium
// whose pages run the page functions here, against the tiny game
// ---------------------------------------------------------------------------

const URL = "http://localhost:3000/";

const FLAGS = [
  "--enable-unsafe-webgpu",
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist"
];

const tolerance = { ratio: 0.001, threshold: 24 };

/**
 * A test that opens the reward popup from Home with a number of coins.
 *
 * @param coins - The coins of the starting player.
 * @param name - The test name.
 * @returns The test.
 */
function openPopup(coins: number, name = "open-popup"): VisualTest {
  return defineVisualTest(name, {
    start: { player: { coins }, checkpoint: "home" },
    steps: [{ tap: { key: "open" } }, { checkpoint: "open" }]
  });
}

/**
 * Reads the bytes a data URL carries.
 *
 * @param url - A data URL.
 * @returns The bytes.
 */
function bytesOf(url: string): Buffer {
  return Buffer.from(url.slice("data:image/png;base64,".length), "base64");
}

describe("pixelOutcome", () => {
  it("answers same at or under the tolerated ratio", () => {
    expect(pixelOutcome({ sameSize: true, differing: 0, total: 1000 }, tolerance)).toEqual({
      outcome: "same"
    });
    expect(pixelOutcome({ sameSize: true, differing: 1, total: 1000 }, tolerance)).toEqual({
      outcome: "same"
    });
  });

  it("answers different with the ratio of differing pixels over it", () => {
    expect(pixelOutcome({ sameSize: true, differing: 2, total: 1000 }, tolerance)).toEqual({
      outcome: "different",
      pixelRatio: 0.002
    });
  });

  it("answers different at size for two pictures of two sizes", () => {
    expect(pixelOutcome({ sameSize: false, differing: 0, total: 0 }, tolerance)).toEqual({
      outcome: "different",
      first: "size"
    });
  });
});

describe("withPixels: the verdict of a pixel difference", () => {
  const base: CheckpointResult = {
    name: "open",
    state: "same",
    describe: "same",
    pixels: "skipped"
  };
  const different = { outcome: "different", pixelRatio: 0.25 } as const;

  it("calls it a rendering regression when the state and the describe were the same", () => {
    expect(withPixels(base, { state: { outcome: "same" }, pixels: different })).toEqual({
      ...base,
      pixels: "different",
      pixelRatio: 0.25,
      verdict: "rendering"
    });
  });

  it.each<[string, Partial<CheckpointResult>]>([
    ["the state differed headless", { state: "different", first: "player.coins" }],
    ["the describe differed headless", { describe: "different", first: "ui.children[0].rect.y" }],
    ["the state was written", { state: "written" }],
    ["the describe was written", { describe: "written" }]
  ])("calls it behaviour when %s", (_, headless) => {
    const merged = withPixels({ ...base, ...headless }, { state: undefined, pixels: different });

    expect(merged).toMatchObject({ ...headless, pixels: "different", verdict: "behaviour" });
  });

  it("takes a state the page reached differently as a state difference, with its path", () => {
    const merged = withPixels(base, {
      state: { outcome: "different", first: "player.coins" },
      pixels: different
    });

    expect(merged).toEqual({
      ...base,
      state: "different",
      first: "player.coins",
      pixels: "different",
      pixelRatio: 0.25,
      verdict: "behaviour"
    });
  });

  it("names the state's first difference before the describe's", () => {
    const pageState = { outcome: "different", first: "player.coins" } as const;
    const same = { outcome: "same" } as const;

    expect(
      withPixels({ ...base, state: "different", first: "path" }, { state: pageState, pixels: same })
        .first
    ).toBe("path");
    expect(
      withPixels(
        { ...base, describe: "different", first: "ui.key" },
        { state: pageState, pixels: same }
      ).first
    ).toBe("player.coins");
  });

  it("adds no ratio and no verdict to a screen that is the same or was written", () => {
    expect(withPixels(base, { state: undefined, pixels: { outcome: "same" } })).toEqual({
      ...base,
      pixels: "same"
    });
    expect(withPixels(base, { state: undefined, pixels: { outcome: "written" } })).toEqual({
      ...base,
      pixels: "written"
    });
  });

  it("names the size as the first difference when nothing else differs", () => {
    expect(
      withPixels(base, { state: undefined, pixels: { outcome: "different", first: "size" } })
    ).toEqual({ ...base, pixels: "different", first: "size", verdict: "rendering" });
  });
});

describe("loadChromium", () => {
  afterEach(() => {
    vi.doUnmock("playwright-core");
    vi.resetModules();
  });

  it("loads chromium from playwright-core, lazily", async () => {
    const chromium = await loadChromium();

    expect(typeof chromium.launch).toBe("function");
  });

  it("names the missing module and the way out", async () => {
    vi.resetModules();
    vi.doMock("playwright-core", () => {
      throw new Error("Cannot find package 'playwright-core'");
    });

    const fresh = await import("../../../src/visual/leg-browser");

    await expect(fresh.loadChromium()).rejects.toThrow(
      "[game] The pixel leg needs playwright-core.\n  Add it: bun add -d playwright-core, or run with --no-pixels."
    );
  });
});

describe("launchChrome", () => {
  const missing = "browserType.launch: Executable doesn't exist at /cache/chromium\nLooks like...";

  it("launches Playwright's own Chromium with the four WebGPU flags by default", async () => {
    const { chromium, log } = fakeChromium();

    await launchChrome(chromium, undefined);

    expect(log.launches).toEqual([{ args: FLAGS }]);
  });

  it("falls back to the system Chrome when Playwright's Chromium is not installed", async () => {
    const { chromium, log } = fakeChromium({
      launch: options => (options.channel === undefined ? missing : undefined)
    });

    await launchChrome(chromium, undefined);

    expect(log.launches).toEqual([{ args: FLAGS }, { channel: "chrome", args: FLAGS }]);
  });

  it("names what is missing when no Chrome launches", async () => {
    const { chromium } = fakeChromium({ launch: () => missing });

    await expect(launchChrome(chromium, undefined)).rejects.toThrow(
      "[game] No Chrome launched: Executable doesn't exist at /cache/chromium.\n  Install Playwright's Chromium (bunx playwright-core install chromium), set page.browser, or run with --no-pixels."
    );
  });

  it("launches the Chrome of page.browser, and that one only", async () => {
    const { chromium, log } = fakeChromium();

    await launchChrome(chromium, { executablePath: "/opt/chrome/chrome" });

    expect(log.launches).toEqual([{ executablePath: "/opt/chrome/chrome", args: FLAGS }]);
  });

  it("names a page.browser that does not launch", async () => {
    const { chromium, log } = fakeChromium({
      launch: () =>
        "launch: Chromium distribution 'msedge' is not found at /Applications/Edge\nRun..."
    });

    await expect(launchChrome(chromium, { channel: "msedge" })).rejects.toThrow(
      "[game] Chrome did not launch from page.browser: Chromium distribution 'msedge' is not found at /Applications/Edge.\n  Fix page.browser, or run with --no-pixels."
    );
    expect(log.launches).toHaveLength(1);
  });
});

describe("pageSize", () => {
  it("opens a 390 wide phone at 2x, as tall as the inert frame of the game", () => {
    expect(pageSize({ app: createTinyGame }, { url: URL })).toEqual({
      viewport: { width: 390, height: 520 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
  });

  it("follows the width and the device scale of the page", () => {
    expect(
      pageSize({ app: createTinyGame }, { url: URL, width: 300, deviceScaleFactor: 3 })
    ).toMatchObject({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 3 });
  });
});

describe("runBrowserLeg", () => {
  let dir = "";
  let stops: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "moku-visual-browser-"));
  });

  afterEach(async () => {
    for (const stop of stops) await stop();
    stops = [];
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const setup: VisualSetup = { app: createTinyGame, page: { url: URL } };

  /**
   * Starts the page game, with the fake codec, and stops it after the test.
   *
   * @param options - What the renderer reports and captures.
   * @returns The page game.
   */
  async function pageGame(options: Parameters<typeof startPageGame>[0] = {}) {
    installCodec();

    const started = await startPageGame(options);

    stops.push(started.stop);

    return started;
  }

  /**
   * Runs both legs as `runVisualTests` does, the browser leg on a fake chromium.
   *
   * @param tests - The tests.
   * @param chromium - The fake.
   * @param options - Overrides of the run.
   * @returns What the browser leg answered.
   */
  async function bothLegs(tests: VisualTest[], chromium: Chromium, options: VisualOptions = {}) {
    const visualRun = resolveVisualOptions(setup, { argv: [], dir, pixels: true, ...options });
    const headless = await runHeadlessLeg(setup, tests, visualRun);

    return runBrowserLeg(setup, tests, visualRun, headless, () => Promise.resolve(chromium));
  }

  /**
   * Names a file of the checkpoint "open" of the test "open-popup".
   *
   * @param name - The file name.
   * @returns The path.
   */
  function file(name: string): string {
    return path.join(dir, "open-popup", "open", name);
  }

  it("writes screen.png on the first run and finds the same screen on the second", async () => {
    const screen = pngOf(4, 4);

    await pageGame({ screen: () => screen });

    const { chromium, log } = fakeChromium();
    const first = await bothLegs([openPopup(7)], chromium);

    expect(first).toEqual([
      {
        name: "open-popup",
        checkpoints: [{ name: "open", state: "written", describe: "written", pixels: "written" }]
      }
    ]);
    expect(await readFile(file("screen.png"))).toEqual(bytesOf(screen));

    const second = await bothLegs([openPopup(7)], chromium);

    expect(second[0]?.checkpoints).toEqual([
      { name: "open", state: "same", describe: "same", pixels: "same" }
    ]);
    expect(log.urls).toEqual([URL, URL]);
    expect(log.scripts).toEqual([pageScript(), pageScript()]);
    expect(log.contexts[0]).toEqual({
      viewport: { width: 390, height: 520 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    expect(log.pagesClosed).toBe(2);
    expect(log.browsersClosed).toBe(2);
  });

  it("finds a changed pixel: a rendering regression, the actual and the diff beside the baseline", async () => {
    const shot = { url: pngOf(4, 4) };

    await pageGame({ screen: () => shot.url });

    const { chromium } = fakeChromium();

    await bothLegs([openPopup(7)], chromium);

    const changed = pngOf(4, 4, index => (index === 5 ? [250, 20, 30, 255] : [10, 20, 30, 255]));

    shot.url = changed;

    const results = await bothLegs([openPopup(7)], chromium);

    expect(results[0]?.checkpoints).toEqual([
      {
        name: "open",
        state: "same",
        describe: "same",
        pixels: "different",
        pixelRatio: 1 / 16,
        verdict: "rendering"
      }
    ]);
    expect(await readFile(file("screen.png"))).toEqual(bytesOf(pngOf(4, 4)));
    expect(await readFile(file("screen.actual.png"))).toEqual(bytesOf(changed));

    const diffBytes = await readFile(file("screen.diff.png"));
    const diff = pictureOf(`data:image/png;base64,${diffBytes.toString("base64")}`);

    expect(diff.data.slice(20, 24)).toEqual([255, 0, 0, 255]);
    expect(diff.data.slice(0, 4)).toEqual([194, 196, 199, 255]);
  });

  it("answers a picture of another size as different at size, with no diff picture", async () => {
    const shot = { url: pngOf(4, 4) };

    await pageGame({ screen: () => shot.url });

    const { chromium } = fakeChromium();

    await bothLegs([openPopup(7)], chromium);
    shot.url = pngOf(4, 3);

    const results = await bothLegs([openPopup(7)], chromium);

    expect(results[0]?.checkpoints[0]).toMatchObject({
      pixels: "different",
      first: "size",
      verdict: "rendering"
    });
    expect(await readFile(file("screen.actual.png"))).toEqual(bytesOf(shot.url));
    await expect(readFile(file("screen.diff.png"))).rejects.toThrow("ENOENT");
  });

  it("rewrites screen.png with --update", async () => {
    const shot = { url: pngOf(4, 4) };

    await pageGame({ screen: () => shot.url });

    const { chromium } = fakeChromium();

    await bothLegs([openPopup(7)], chromium);
    shot.url = pngOf(2, 2);

    const results = await bothLegs([openPopup(7)], chromium, { update: true });

    expect(results[0]?.checkpoints[0]).toMatchObject({ pixels: "written" });
    expect(await readFile(file("screen.png"))).toEqual(bytesOf(shot.url));
  });

  it("compares the page's state with state.json: a difference there is a state difference", async () => {
    await pageGame();

    const { chromium } = fakeChromium();
    const visualRun = resolveVisualOptions(setup, { argv: [], dir, pixels: true });

    await bothLegs([openPopup(7)], chromium);

    const headless = await runHeadlessLeg(setup, [openPopup(7)], visualRun);
    const baseline = JSON.parse(await readFile(file("state.json"), "utf8"));

    await writeFile(file("state.json"), stableJson({ ...baseline, player: { coins: 8 } }));

    const results = await runBrowserLeg(setup, [openPopup(7)], visualRun, headless, () =>
      Promise.resolve(chromium)
    );

    expect(results[0]?.checkpoints[0]).toEqual({
      name: "open",
      state: "different",
      describe: "same",
      pixels: "same",
      first: "player.coins"
    });
  });

  it("ends a test whose page gives no picture, and plays the next one", async () => {
    const shots = [undefined, pngOf(2, 2)];

    await pageGame({ screen: () => shots.shift() });

    const { chromium } = fakeChromium();
    const results = await bothLegs([openPopup(7, "first"), openPopup(7, "second")], chromium);

    expect(results[0]).toEqual({
      name: "first",
      checkpoints: [{ name: "open", state: "written", describe: "written", pixels: "skipped" }],
      error:
        '[game] Visual test "first", step 2 (checkpoint): the page gave no picture.\n  Serve a dev build with WebGPU: renderer.capture() answers only there.'
    });
    expect(results[1]?.checkpoints[0]).toMatchObject({ pixels: "written" });
  });

  it("ends a test whose command fails in the page, naming the step", async () => {
    await pageGame();
    vi.stubGlobal("doors", {
      read,
      sources,
      commands,
      run: (app: object, command: { id: string }, input: object) =>
        command.id === "game.tap"
          ? Promise.reject(new Error("[game] The canvas moved.\n  Hold still."))
          : Reflect.apply(run, undefined, [app, command, input])
    });

    const { chromium } = fakeChromium();
    const results = await bothLegs([openPopup(7)], chromium);

    expect(results[0]?.error).toBe(
      '[game] Visual test "open-popup", step 1 (tap) failed.\n  The canvas moved. Hold still.'
    );
  });

  it("ends a test whose step does not settle in the page", async () => {
    const { game } = await pageGame();
    const stuck = { on: false };

    vi.stubGlobal("game", {
      ...game,
      flow: {
        ...game.flow,
        state: () => (stuck.on ? { ...game.flow.state(), pending: {} } : game.flow.state())
      }
    });
    vi.stubGlobal("doors", {
      read,
      sources,
      commands,
      run: (app: object, command: { id: string }, input: object) => {
        stuck.on = command.id === "game.tap";

        return Reflect.apply(run, undefined, [app, command, input]);
      }
    });

    const { chromium } = fakeChromium();
    const visualRun = resolveVisualOptions(setup, { argv: [], dir, pixels: true });
    const headless = await runHeadlessLeg(setup, [openPopup(7)], visualRun);
    const results = await runBrowserLeg(
      setup,
      [openPopup(7)],
      { ...visualRun, settleFrames: 5 },
      headless,
      () => Promise.resolve(chromium)
    );

    expect(results[0]?.error).toBe(
      '[game] Visual test "open-popup", step 1 (tap) did not settle in 5 frames.\n  The graph stands at "reward"; add a step that answers what it waits for.'
    );
  });

  it("ends a test whose page breaks during a step", async () => {
    await pageGame();

    const faults: BrowserFaults = {
      evaluate: fn => (fn === pageStep ? "Target crashed" : undefined)
    };
    const { chromium, log } = fakeChromium(faults);
    const results = await bothLegs([openPopup(7)], chromium);

    expect(results[0]?.error).toBe(
      '[game] Visual test "open-popup", the start failed.\n  Target crashed.'
    );
    expect(log.pagesClosed).toBe(1);
  });

  it("leaves a test the headless leg failed as it was", async () => {
    await pageGame();

    const { chromium, log } = fakeChromium();
    const failed: VisualTestResult = {
      name: "open-popup",
      checkpoints: [],
      error: "[game] Boom.\n  Fix it."
    };
    const visualRun = resolveVisualOptions(setup, { argv: [], dir, pixels: true });
    const results = await runBrowserLeg(setup, [openPopup(7)], visualRun, [failed], () =>
      Promise.resolve(chromium)
    );

    expect(results).toEqual([failed]);
    expect(log.urls).toEqual([]);
    expect(log.browsersClosed).toBe(1);
  });

  it("fails the leg on a page with no game and doors, and closes the browser", async () => {
    const { chromium, log } = fakeChromium({ ready: false });

    await expect(bothLegs([openPopup(7)], chromium)).rejects.toThrow(
      `[game] The page at ${URL} exposes no game and doors.\n  Serve the dev page (bun ./web/serve.ts) and set globalThis.game and globalThis.doors in it.`
    );
    expect(log.pagesClosed).toBe(1);
    expect(log.browsersClosed).toBe(1);
  });

  it("refuses a page that draws with WebGL: there are no WebGL baselines", async () => {
    await pageGame({ kind: "webgl" });

    const { chromium, log } = fakeChromium();

    await expect(bothLegs([openPopup(7)], chromium)).rejects.toThrow(
      `[game] The page at ${URL} draws with webgl, not WebGPU.\n  The pixel baselines are WebGPU only: use a Chrome with WebGPU on a Mac, or run with --no-pixels.`
    );
    expect(log.browsersClosed).toBe(1);
  });

  it("names a page that does not open", async () => {
    const { chromium } = fakeChromium({ goto: `net::ERR_CONNECTION_REFUSED at ${URL}` });

    await expect(bothLegs([openPopup(7)], chromium)).rejects.toThrow(
      `[game] The page at ${URL} did not open: net::ERR_CONNECTION_REFUSED at ${URL}.\n  Serve the dev page (bun ./web/serve.ts), or run with --no-pixels.`
    );
  });

  it("names a page that does not start", async () => {
    await pageGame({ runGraph: false });

    const { chromium } = fakeChromium();

    await expect(bothLegs([openPopup(7)], chromium, { settleFrames: 3 })).rejects.toThrow(
      `[game] The page at ${URL} did not rest at a gate in 3 frames.`
    );
  });

  it("names a page that breaks while it starts", async () => {
    await pageGame();

    const { chromium } = fakeChromium({ evaluate: () => "Target crashed" });

    await expect(bothLegs([openPopup(7)], chromium)).rejects.toThrow(
      `[game] The page at ${URL} did not start.\n  Target crashed.`
    );
  });

  it("needs the dev page", async () => {
    const visualRun = resolveVisualOptions(setup, { argv: [], dir, pixels: true });

    await expect(runBrowserLeg({ app: createTinyGame }, [], visualRun, [])).rejects.toThrow(
      "[game] The pixel leg needs the dev page.\n  Pass page: { url } in the setup, or run with --no-pixels."
    );
  });
});
