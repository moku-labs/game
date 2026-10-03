/**
 * @file The visual tests of the fixture game, headless, in every `bun run test`: each test plays
 * live in plain Bun and every checkpoint answers `same` against the committed `state.json` and
 * `describe.json` under `tests/visual/`. `argv: []`, so the flags vitest got never steer the run;
 * `pixels: false`, so no browser opens. A checkpoint with no baseline is written and fails here:
 * write the baselines with `bun run fixture:visual --update` and commit them.
 */
import { fileURLToPath } from "node:url";
import { runVisualTests } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { fixtureApp } from "../visual/fixture";
import { fixtureVisualTests } from "../visual/tests";

/** The folder of the visual tests and their baselines. */
const dir = fileURLToPath(new URL("../visual/", import.meta.url));

describe("visual tests of the fixture game, headless", () => {
  it("answers same at every checkpoint of every test", async () => {
    const report = await runVisualTests({ app: fixtureApp }, fixtureVisualTests, {
      dir,
      pixels: false,
      argv: []
    });
    const outcomes = report.tests.flatMap(test =>
      test.checkpoints.map(checkpoint => ({
        at: `${test.name}/${checkpoint.name}`,
        state: checkpoint.state,
        describe: checkpoint.describe,
        first: checkpoint.first
      }))
    );

    expect(report.tests.map(test => test.error)).toEqual(fixtureVisualTests.map(() => undefined));
    expect(outcomes).toEqual([
      { at: "home/rest", state: "same", describe: "same", first: undefined },
      { at: "board-merge/merged", state: "same", describe: "same", first: undefined },
      { at: "reward-popup/open", state: "same", describe: "same", first: undefined },
      { at: "rename-popup/typed", state: "same", describe: "same", first: undefined },
      { at: "rename-popup/saved", state: "same", describe: "same", first: undefined },
      { at: "gift-popup/open", state: "same", describe: "same", first: undefined },
      { at: "settings/open", state: "same", describe: "same", first: undefined }
    ]);
    expect(report.ok).toBe(true);
  }, 120_000);
});
