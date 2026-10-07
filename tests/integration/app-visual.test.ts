/**
 * @file `moku-game visual` end to end: the test bin started as a person starts it, on the mini
 * game, headless (`--no-pixels`). The tests module is the engine's `tests/visual/index.ts` and the
 * baselines are the committed headless ones, so a run answers `same` at every checkpoint.
 */
import { describe, expect, it } from "vitest";
import { runBin } from "./app-helpers";

/** The flags every run of this file starts with: the mini game, its tests and baselines. */
const MINI = [
  "visual",
  "--root",
  "tests/fixtures/mini-game",
  "--tests",
  "tests/visual/index.ts",
  "--dir",
  "tests/visual",
  "--no-pixels"
];

describe("moku-game visual on the mini game", () => {
  it("plays one test headless and exits 0 when its checkpoint is the same", async () => {
    const ran = await runBin([...MINI, "--only", "home"]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain("home/rest: state same · describe same · pixels skipped");
    expect(ran.stdout).not.toContain("info-popup");
  }, 60_000);

  it("exits 1 with the message when --only names no test", async () => {
    const ran = await runBin([...MINI, "--only", "nope"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain('[game] No visual test is named "nope".');
  }, 60_000);

  it("exits 1 when the tests module is missing", async () => {
    const ran = await runBin(["visual", "--root", "tests/fixtures/mini-game", "--no-pixels"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      "[game] visual: tests/fixtures/mini-game/tests/visual/index.ts must export default { app, tests }."
    );
  }, 60_000);
});
