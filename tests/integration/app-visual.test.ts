/**
 * @file `moku-game visual` end to end: the test bin started as a person starts it, on the mini
 * game, headless (`--no-pixels`). The tests module is the engine's `tests/visual/index.ts` and the
 * baselines are the committed headless ones, so a run answers `same` at every checkpoint. The
 * page of the pixel leg is served from `.moku/visual/` of a copy in a Bun child and really
 * bundles: its script carries the game's strings.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copyMiniGame, REPO, removeCopies, runBin } from "./app-helpers";

/** The copies of this file, removed after it. */
const copies: string[] = [];

afterAll(() => {
  removeCopies(copies);
});

/** What the child saw of the served visual page. */
type Served = { status: number; game: boolean; title: boolean };

/**
 * Serves the visual page of a game in a Bun child the way `moku-game visual` does, fetches the page
 * and its script, and stops the server.
 *
 * @param root - The game folder.
 * @returns The status of the script and whether the page and the script carry the game.
 */
function serveInChild(root: string): Served {
  const script = `
    const { serveVisualPage } = await import(${JSON.stringify(path.join(REPO, "src", "app", "visual.ts"))});
    const server = await serveVisualPage(
      { root: process.cwd(), tests: "", flags: [], preload: [], servePlugins: [] },
      { resolve: (specifier, from) => Bun.resolveSync(specifier, from), loadPage: file => import(file) }
    );
    const html = await (await fetch(server.url)).text();
    const source = /<script[^>]*src="([^"]+)"/.exec(html)?.[1] ?? "";
    const response = await fetch(new URL(source, server.url));
    const code = await response.text();
    await server.stop(true);
    process.stdout.write(JSON.stringify({
      status: response.status,
      game: code.includes("Tap the"),
      title: html.includes("<title>mini-game</title>")
    }));
  `;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const ran = spawnSync("bun", ["--eval", script], { cwd: root, encoding: "utf8" });

  if (ran.status !== 0) throw new Error(`The Bun child failed.\n  ${ran.stderr}.`);

  return JSON.parse(ran.stdout.slice(ran.stdout.indexOf("{"))) as Served;
}

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

  it("serves its own page from .moku/visual/, which bundles the game from two folders up", () => {
    const root = copyMiniGame("visual-page");

    copies.push(root);

    expect(serveInChild(root)).toEqual({ status: 200, game: true, title: true });
    expect(readFileSync(path.join(root, ".moku", "visual", "main.ts"), "utf8")).toContain(
      'import game from "../../index.ts";'
    );
    expect(existsSync(path.join(root, ".moku", "main.ts"))).toBe(false);
  }, 60_000);

  it("exits 1 when the tests module is missing", async () => {
    const ran = await runBin(["visual", "--root", "tests/fixtures/mini-game", "--no-pixels"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      "[game] visual: tests/fixtures/mini-game/tests/visual/index.ts must export default { app, tests }."
    );
  }, 60_000);
});
