/**
 * @file `moku-game visual` end to end: the test bin started as a person starts it, on the mini
 * game, headless (`--no-pixels`). The tests module is the engine's `tests/visual/index.ts` and the
 * baselines are the committed headless ones, so a run answers `same` at every checkpoint. The
 * page of the pixel leg is served from `.moku/visual/` of a copy in a Bun child and really
 * bundles: its script carries the game's strings. Under `--config=.moku/visual/bunfig.toml`, the
 * way the command runs its child, a serve plugin changes the page.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeVisualPage } from "../../src/app/visual";
import { copyMiniGame, REPO, removeCopies, runBin } from "./app-helpers";

/** What the serve plugin of the test writes into the page. */
const MARK = "marked by the serve plugin";

/** A serve plugin that replaces the `dev.ts` of the visual page, so the page carries `MARK`. */
const MARK_PLUGIN = String.raw`export default {
  name: "mark",
  setup(build) {
    build.onLoad({ filter: /[\/]\.moku[\/]visual[\/]dev\.ts$/ }, () => ({
      contents: 'globalThis.__MOKU_GAME_DEV__ = true;\nglobalThis.__MOKU_MARK__ = "marked by the serve plugin";\n',
      loader: "ts"
    }));
  }
};
`;

/** The copies of this file, removed after it. */
const copies: string[] = [];

afterAll(() => {
  removeCopies(copies);
});

/** What the child saw of the served visual page. */
type Served = { status: number; game: boolean; title: boolean; marked: boolean };

/**
 * Serves the visual page of a game in a Bun child the way `moku-game visual` does, fetches the page
 * and its script, and stops the server.
 *
 * @param root - The game folder.
 * @param bun - The flags of the Bun child, such as `--config=<bunfig>`.
 * @param servePlugins - The serve plugins the page is written with.
 * @returns The status of the script and whether the page and the script carry the game and the mark.
 */
function serveInChild(root: string, bun: string[] = [], servePlugins: string[] = []): Served {
  const script = `
    const { serveVisualPage } = await import(${JSON.stringify(path.join(REPO, "src", "app", "visual.ts"))});
    const server = await serveVisualPage(
      { root: process.cwd(), preload: [], servePlugins: ${JSON.stringify(servePlugins)} },
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
      title: html.includes("<title>mini-game</title>"),
      marked: code.includes(${JSON.stringify(MARK)})
    }));
  `;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const ran = spawnSync("bun", [...bun, "--eval", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, MOKU_GAME_CHILD: "1" },
    timeout: 50_000
  });

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

    expect(serveInChild(root)).toEqual({ status: 200, game: true, title: true, marked: false });
    expect(readFileSync(path.join(root, ".moku", "visual", "main.ts"), "utf8")).toContain(
      'import game from "../../index.ts";'
    );
    expect(existsSync(path.join(root, ".moku", "main.ts"))).toBe(false);
  }, 60_000);

  it("applies a serve plugin under the page's bunfig, the way the command runs its child", async () => {
    const root = copyMiniGame("visual-plugin");
    const plugin = path.join(root, "tree", "mark.ts");

    copies.push(root);
    mkdirSync(path.dirname(plugin), { recursive: true });
    writeFileSync(plugin, MARK_PLUGIN);

    const page = await writeVisualPage(
      { root, preload: [], servePlugins: [plugin] },
      (specifier, from) => Bun.resolveSync(specifier, from)
    );

    expect(serveInChild(root, [`--config=${page.bunfig}`], [plugin])).toEqual({
      status: 200,
      game: true,
      title: true,
      marked: true
    });
    // Bundled without the bunfig, as the bin process itself would, the page misses the change.
    expect(serveInChild(root, [], [plugin]).marked).toBe(false);
  }, 60_000);

  it("exits 1 when the tests module is missing", async () => {
    const ran = await runBin(["visual", "--root", "tests/fixtures/mini-game", "--no-pixels"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      "[game] visual: tests/fixtures/mini-game/tests/visual/index.ts must export default { app, tests }."
    );
  }, 60_000);
});
