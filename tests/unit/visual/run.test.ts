import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineVisualTest } from "../../../src/visual/define";
import { runBrowserLeg } from "../../../src/visual/leg-browser";
import { runVisualTests } from "../../../src/visual/run";
import type { CheckpointResult, VisualSetup, VisualTest } from "../../../src/visual/types";
import { createTinyGame } from "./game";

// The browser leg keeps its own code unless a test hands it an answer.
vi.mock("../../../src/visual/leg-browser", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/visual/leg-browser")>();

  return { ...original, runBrowserLeg: vi.fn(original.runBrowserLeg) };
});

// ---------------------------------------------------------------------------
// Unit (the tiny game in plain Bun): runVisualTests selects the tests, runs
// the headless leg, prints one line per checkpoint and answers one report
// ---------------------------------------------------------------------------

let dir = "";
let lines: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moku-visual-run-"));
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const setup: VisualSetup = { app: createTinyGame };

/**
 * A test that taps Open from Home with a number of coins and checks the popup.
 *
 * @param name - The test name.
 * @param coins - The coins of the starting player.
 * @returns The test.
 */
function popupTest(name: string, coins: number) {
  return defineVisualTest(name, {
    start: { player: { coins }, checkpoint: "home" },
    steps: [{ tap: { key: "open" } }, { checkpoint: "open" }]
  });
}

/**
 * Hands the browser leg an answer: every checkpoint of the headless leg with these pixels.
 *
 * @param pixels - The pixel fields of every checkpoint.
 */
function pixelsAnswer(pixels: Partial<CheckpointResult>) {
  vi.mocked(runBrowserLeg).mockImplementationOnce((_setup, _tests, _run, headless) =>
    Promise.resolve(
      headless.map(test => ({
        ...test,
        checkpoints: test.checkpoints.map(checkpoint => ({ ...checkpoint, ...pixels }))
      }))
    )
  );
}

describe("runVisualTests", () => {
  it("answers ok on the first run, which writes, and on the second, which compares", async () => {
    const first = await runVisualTests(setup, [popupTest("popup", 7)], { argv: [], dir });
    const second = await runVisualTests(setup, [popupTest("popup", 7)], { argv: [], dir });

    expect(first.ok).toBe(true);
    expect(first.tests[0]?.checkpoints[0]).toMatchObject({ state: "written", describe: "written" });
    expect(second).toEqual({
      ok: true,
      tests: [
        {
          name: "popup",
          checkpoints: [{ name: "open", state: "same", describe: "same", pixels: "skipped" }]
        }
      ]
    });
  });

  it("answers not ok on a difference, and prints one line per checkpoint with the path", async () => {
    await runVisualTests(setup, [popupTest("popup", 7)], { argv: [], dir });
    lines = [];

    const report = await runVisualTests(setup, [popupTest("popup", 9)], { argv: [], dir });

    expect(report.ok).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("popup/open");
    expect(lines[0]).toContain("state different at player.coins");
    expect(lines[0]).toContain("describe same");
    expect(lines[0]).toContain("pixels skipped");
  });

  it("answers not ok when a test failed, and prints its error", async () => {
    const broken = defineVisualTest("broken", {
      start: { player: { coins: 1 }, checkpoint: "home" },
      steps: [{ tap: { key: "missing" } }]
    });
    const report = await runVisualTests(setup, [broken], { argv: [], dir });

    expect(report.ok).toBe(false);
    expect(report.tests[0]?.error).toContain("step 1 (tap) failed");
    expect(lines.join("\n")).toContain('No element with the key "missing" is on screen.');
  });

  it("runs only the tests --only names, in the order they were given", async () => {
    const tests = [popupTest("first", 1), popupTest("second", 2), popupTest("third", 3)];
    const report = await runVisualTests(setup, tests, {
      argv: ["--only", "third", "--only", "first"],
      dir
    });

    expect(report.tests.map(test => test.name)).toEqual(["first", "third"]);
  });

  it("refuses an --only name no test has", async () => {
    await expect(
      runVisualTests(setup, [popupTest("popup", 1)], { argv: ["--only", "popop"], dir })
    ).rejects.toThrow('[game] No visual test is named "popop".\n  Use one of: popup.');
  });

  it("refuses two tests with one name: they would share their baselines", async () => {
    await expect(
      runVisualTests(setup, [popupTest("popup", 1), popupTest("popup", 2)], { argv: [], dir })
    ).rejects.toThrow(
      '[game] Two visual tests are named "popup".\n  Give every visual test its own name.'
    );
  });

  it("reads its flags from process.argv when called without options", async () => {
    const saved = process.argv;

    process.argv = ["bun", "tests/visual/run.ts", "--dir", dir, "--only", "popup"];

    try {
      const report = await runVisualTests(setup, [popupTest("popup", 1), popupTest("other", 2)]);

      expect(report.tests.map(test => test.name)).toEqual(["popup"]);
      expect(report.tests[0]?.checkpoints[0]).toMatchObject({ state: "written" });
    } finally {
      process.argv = saved;
    }
  });

  it("checks a test written by hand, so its name cannot leave the folder", async () => {
    const handMade: VisualTest = { name: "../outside", start: { player: {} }, steps: [] };

    await expect(runVisualTests(setup, [handMade], { argv: [], dir })).rejects.toThrow(
      '[game] The visual test name "../outside" is not a file name.'
    );
  });

  it("fails a run with pixels and no page, after printing the headless lines", async () => {
    await expect(
      runVisualTests(setup, [popupTest("popup", 1)], { argv: [], dir, pixels: true })
    ).rejects.toThrow(
      "[game] The pixel leg needs the dev page.\n  Pass page: { url } in the setup, or run with --no-pixels."
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("pixels skipped");
  });

  const withPage: VisualSetup = { ...setup, page: { url: "http://localhost:3000/" } };

  it("runs the browser leg after the headless one and prints the share of differing pixels", async () => {
    pixelsAnswer({ pixels: "different", pixelRatio: 0.0042, verdict: "rendering" });

    const report = await runVisualTests(withPage, [popupTest("popup", 7)], {
      argv: [],
      dir,
      pixels: true
    });

    expect(report.ok).toBe(false);
    expect(lines).toEqual([expect.stringContaining("pixels different 0.42% (rendering)")]);
    expect(vi.mocked(runBrowserLeg)).toHaveBeenLastCalledWith(
      withPage,
      [expect.objectContaining({ name: "popup" })],
      expect.objectContaining({ pixels: true, dir }),
      [expect.objectContaining({ name: "popup" })]
    );
  });

  it("prints a picture of another size, and answers ok when the pixels are the same", async () => {
    pixelsAnswer({ pixels: "different", first: "size", verdict: "behaviour" });
    await runVisualTests(withPage, [popupTest("popup", 7)], { argv: [], dir, pixels: true });

    expect(lines[0]).toContain("pixels different at size (behaviour)");

    pixelsAnswer({ pixels: "same" });

    const report = await runVisualTests(withPage, [popupTest("popup", 7)], {
      argv: [],
      dir,
      pixels: true
    });

    expect(report.ok).toBe(true);
    expect(lines[1]).toContain("pixels same");
  });
});
