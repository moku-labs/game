/**
 * @file The visual tests of the mini game, headless, in every `bun run test`: each test plays
 * live in plain Bun and every checkpoint answers `same` against the committed `state.json` and
 * `describe.json` under `tests/visual/`. `argv: []`, so the flags vitest got never steer the run;
 * `pixels: false`, so no browser opens. A checkpoint with no baseline is written and fails here:
 * write the baselines with `bun run mini:visual --no-pixels --update` and commit them.
 */
import { fileURLToPath } from "node:url";
import type { VisualReport } from "@moku-labs/game/visual";
import { runVisualTests } from "@moku-labs/game/visual";
import { beforeAll, describe, expect, it } from "vitest";
import { miniApp } from "../visual/fixture";
import { miniVisualTests } from "../visual/tests";

/** The folder of the visual tests and their baselines. */
const dir = fileURLToPath(new URL("../visual/", import.meta.url));

/** Every checkpoint of every visual test of the mini game, as `test/checkpoint`, in run order. */
const checkpoints = ["home/rest", "info-popup/open"];

describe("visual tests of the mini game, headless", () => {
  let report: VisualReport;

  beforeAll(async () => {
    report = await runVisualTests({ app: miniApp }, miniVisualTests, {
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
    expect(report.tests.map(test => test.error)).toEqual(miniVisualTests.map(() => undefined));
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
