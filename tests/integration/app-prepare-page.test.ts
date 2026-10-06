/**
 * @file `preparePage`, the editor's seam of `@moku-labs/game/cli`, on copies of the mini game in
 * the engine repo: the four files under `.moku/`, the absolute paths it returns, no rewrite on a
 * second call, the hot plugin of the working tree, the agents and `.dev` modules on the page, and
 * the refusals of a folder that is not a game. It runs Bun's resolver, so it needs Bun.
 */
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { preparePage } from "../../src/cli";
import { copyMiniGame, REPO, removeCopies } from "./app-helpers";

/** The copies of this file, removed after it. */
const copies: string[] = [];

/**
 * Copies the mini game for one test.
 *
 * @returns The copy.
 */
function game(): string {
  const copy = copyMiniGame("prepare");

  copies.push(copy);

  return copy;
}

/**
 * Reads a file of the written page.
 *
 * @param root - The game folder.
 * @param file - The file under `.moku/`.
 * @returns The text.
 */
function page(root: string, file: string): string {
  return readFileSync(path.join(root, ".moku", file), "utf8");
}

afterAll(() => {
  removeCopies(copies);
});

describe.skipIf(typeof Bun === "undefined")("preparePage", () => {
  it("preparePage writes index.html, main.ts, dev.ts and bunfig.toml under .moku", async () => {
    const root = game();

    await preparePage(root);

    expect(page(root, "index.html")).toContain('<script type="module" src="./main.ts"></script>');
    expect(page(root, "index.html")).toContain("<title>mini-game</title>");
    expect(page(root, "main.ts")).toContain('import scenario0 from "../tests/scenarios/ready.ts";');
    expect(page(root, "dev.ts")).toContain("globalThis.__MOKU_GAME_DEV__ = true;");
    expect(page(root, "bunfig.toml")).toContain('define = { "__MOKU_GAME_DEV__" = "true" }');
  });

  it("preparePage returns absolute html and bunfig paths", async () => {
    const root = game();
    const prepared = await preparePage(path.relative(process.cwd(), root));

    expect(prepared).toEqual({
      html: path.join(root, ".moku", "index.html"),
      bunfig: path.join(root, ".moku", "bunfig.toml")
    });
  });

  it("a second preparePage with the same input rewrites nothing", async () => {
    const root = game();
    const files = ["index.html", "dev.ts", "main.ts", "bunfig.toml"].map(file =>
      path.join(root, ".moku", file)
    );
    const old = new Date("2020-01-01T00:00:00Z");

    await preparePage(root, { agents: ["@moku-labs/editor/agent/page"] });
    for (const file of files) utimesSync(file, old, old);
    await preparePage(root, { agents: ["@moku-labs/editor/agent/page"] });

    expect(files.map(file => statSync(file).mtimeMs)).toEqual(files.map(() => old.getTime()));
  });

  it("preparePage lists the hot plugin as src/hot.ts in the engine tree", async () => {
    const root = game();
    const preload = path.join(REPO, "scripts", "tree", "preload.ts");
    const bundle = path.join(REPO, "scripts", "tree", "bundle.ts");

    await preparePage(root, {
      preload: [path.relative(process.cwd(), preload)],
      servePlugins: [bundle]
    });

    expect(page(root, "bunfig.toml")).toBe(
      [
        "# Written by moku-game dev. Do not edit.",
        `preload = [${JSON.stringify(preload)}]`,
        "",
        "[serve.static]",
        `plugins = [${JSON.stringify(path.join(REPO, "src", "hot.ts"))}, ${JSON.stringify(bundle)}]`,
        'define = { "__MOKU_GAME_DEV__" = "true" }',
        ""
      ].join("\n")
    );
  });

  it("preparePage passes the agents to startPage", async () => {
    const root = game();

    writeFileSync(path.join(root, "features", "home", "home.dev.ts"), "export const dev = 1;\n");
    await preparePage(root, { agents: ["@moku-labs/editor/agent/page", "/abs/agent.ts"] });

    const main = page(root, "main.ts");

    expect(main).toContain('import agent0 from "@moku-labs/editor/agent/page";');
    expect(main).toContain('import agent1 from "/abs/agent.ts";');
    expect(main).toContain('import * as devModule0 from "../features/home/home.dev.ts";');
    expect(main).toContain("  agents: [agent0, agent1],\n  devModules: [devModule0]\n");
  });

  it("preparePage refuses a game without config.ts", async () => {
    const root = game();

    rmSync(path.join(root, "config.ts"));

    await expect(preparePage(root)).rejects.toThrow(
      new Error(
        `[game] moku-game: no config.ts in "${root}".\n  A game keeps its page, native, system, save and assets data there.`
      )
    );
    expect(existsSync(path.join(root, ".moku"))).toBe(false);
  });

  it("preparePage refuses a game without index.ts", async () => {
    const root = game();

    rmSync(path.join(root, "index.ts"));

    await expect(preparePage(root)).rejects.toThrow(
      new Error(
        `[game] moku-game: no index.ts in "${root}".\n  It default-exports defineGameApp({ ... }).`
      )
    );
  });
});
