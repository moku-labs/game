/**
 * @file The visual tests of the fixture game, headless, in every `bun run test`: each test plays
 * live in plain Bun and every checkpoint answers `same` against the committed `state.json` and
 * `describe.json` under `tests/visual/`. `argv: []`, so the flags vitest got never steer the run;
 * `pixels: false`, so no browser opens. A checkpoint with no baseline is written and fails here:
 * write the baselines with `bun run fixture:visual --update` and commit them.
 */
import { fileURLToPath } from "node:url";
import type { VisualReport } from "@moku-labs/game/testing";
import { runVisualTests } from "@moku-labs/game/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { fixtureApp } from "../visual/fixture";
import { fixtureVisualTests } from "../visual/tests";

/** The folder of the visual tests and their baselines. */
const dir = fileURLToPath(new URL("../visual/", import.meta.url));

/** Every checkpoint of every fixture visual test, as `test/checkpoint`, in run order. */
const checkpoints = [
  "home/rest",
  "board-merge/merged",
  "reward-popup/open",
  "rename-popup/typed",
  "rename-popup/saved",
  "gift-popup/open",
  "settings/open"
];

describe("visual tests of the fixture game, headless", () => {
  let report: VisualReport;

  beforeAll(async () => {
    report = await runVisualTests({ app: fixtureApp }, fixtureVisualTests, {
      dir,
      pixels: false,
      argv: []
    });
  }, 120_000);

  /**
   * Finds one checkpoint of the report by its address.
   *
   * @param at - The checkpoint address, `test/checkpoint`.
   * @returns The checkpoint, or `undefined` when the report has none at that address.
   */
  function checkpointAt(at: string) {
    const [testName, checkpointName] = at.split("/");
    const test = report.tests.find(candidate => candidate.name === testName);
    return test?.checkpoints.find(candidate => candidate.name === checkpointName);
  }

  it("runs every test without an error", () => {
    expect(report.tests.map(test => test.error)).toEqual(fixtureVisualTests.map(() => undefined));
  });

  it("reaches exactly the expected checkpoints, in order", () => {
    const reached = report.tests.flatMap(test =>
      test.checkpoints.map(checkpoint => `${test.name}/${checkpoint.name}`)
    );

    expect(reached).toEqual(checkpoints);
  });

  it.each(checkpoints)("answers same at %s", at => {
    const checkpoint = checkpointAt(at);

    expect({
      state: checkpoint?.state,
      describe: checkpoint?.describe,
      first: checkpoint?.first
    }).toEqual({ state: "same", describe: "same", first: undefined });
  });

  it("reports ok", () => {
    expect(report.ok).toBe(true);
  });
});
