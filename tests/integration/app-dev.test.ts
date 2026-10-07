/**
 * @file `moku-game dev` end to end: the test bin started as a person starts it, on the mini game
 * and on copies of it. The parent writes the page and re-runs the bin under the generated bunfig;
 * the child serves the page with the engine's hot plugin, the manifest and the game's files, and
 * stops on Ctrl+C. The scenario watcher, `--packed` and a taken port run on copies.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  copyMiniGame,
  holdPort,
  MINI_GAME,
  REPO,
  removeCopies,
  runBin,
  type StartedBin,
  startBin,
  urlOf
} from "./app-helpers";

/** The copies of this file, removed after it. */
const copies: string[] = [];

/** The dev page folder of the fixture: removed after the file when this file wrote it. */
const fixturePage = path.join(MINI_GAME, ".moku");

/** Whether the fixture had its dev page before this file ran: a person's `bun run mini:dev`. */
const hadFixturePage = existsSync(fixturePage);

/** The bound URL line, the only stdout line of this shape. */
const URL_LINE = /^https?:\/\/\S+\/$/gm;

/**
 * Fetches a URL and reads its body as text.
 *
 * @param url - The URL.
 * @returns The body.
 */
async function textOf(url: string): Promise<string> {
  const response = await fetch(url);

  return response.text();
}

/**
 * Fetches a URL and reads its status.
 *
 * @param url - The URL.
 * @returns The status code.
 */
async function statusOf(url: string): Promise<number> {
  const response = await fetch(url);

  return response.status;
}

/**
 * Waits until a condition holds, checking every 50 ms, for at most 20 seconds.
 *
 * @param holds - The condition.
 * @returns Resolves once it holds.
 */
async function waitFor(holds: () => boolean): Promise<void> {
  for (let tries = 0; tries < 400 && !holds(); tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Stops a started bin the way Ctrl+C does and waits for its end.
 *
 * @param started - The started bin.
 * @returns The exit code.
 */
async function interrupt(started: StartedBin): Promise<number | null> {
  started.child.kill("SIGINT");

  return started.exit;
}

/**
 * Copies the mini game for one test.
 *
 * @param prefix - The start of the folder name.
 * @returns The copy.
 */
function game(prefix: string): string {
  const copy = copyMiniGame(prefix);

  copies.push(copy);

  return copy;
}

afterAll(() => {
  removeCopies(copies);
  if (!hadFixturePage) rmSync(fixturePage, { recursive: true, force: true });
});

describe("moku-game dev on the mini game", () => {
  /** The server of this block, started once. */
  const server: { started?: StartedBin; url: string } = { url: "" };

  beforeAll(async () => {
    server.started = startBin(["dev", "--root", "tests/fixtures/mini-game", "--port", "0"]);
    server.url = await urlOf(server.started);
  }, 60_000);

  afterAll(() => {
    server.started?.child.kill("SIGKILL");
  });

  it("prints the bound URL on its own plain line", () => {
    const stdout = server.started?.stdout() ?? "";

    expect(stdout.match(URL_LINE)).toEqual([server.url]);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(stdout).toContain("mini-game: dev server, raw assets. Ctrl+C stops it.");
  });

  it("serves the page on / with div#game and the title", async () => {
    const html = await textOf(server.url);

    expect(html).toContain('<div id="game"></div>');
    expect(html).toContain("<title>mini-game</title>");
  });

  it("serves /manifest.json from the root", async () => {
    const served = await textOf(`${server.url}manifest.json`);

    expect(JSON.parse(served)).toEqual(
      JSON.parse(readFileSync(path.join(MINI_GAME, "manifest.json"), "utf8"))
    );
  });

  it("serves a feature asset", async () => {
    const response = await fetch(`${server.url}features/ui/assets/fx-spark.webp`);
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  it("answers 404 for .moku files, node_modules and ..", async () => {
    for (const refused of [
      ".moku/main.ts",
      ".moku/bunfig.toml",
      "node_modules/pixi.js/package.json",
      "%2E%2E/%2E%2E/package.json",
      "features/ui/assets/missing.png"
    ]) {
      expect(await statusOf(`${server.url}${refused}`), refused).toBe(404);
    }
  });

  it("the page bundle carries the hot footer of a view module", async () => {
    const html = await textOf(server.url);
    const script = /src="(\/_bun\/client\/[^"]+\.js)"/.exec(html)?.[1] ?? "";
    const code = await textOf(new URL(script, server.url).href);

    expect(script).not.toBe("");
    expect(code).toContain("__moku_hot");
    expect(code).toContain(path.join(MINI_GAME, "features", "home", "view.tsx"));
  });

  it("the page bundle has the dev flag on", async () => {
    const html = await textOf(server.url);
    const script = /src="(\/_bun\/client\/[^"]+\.js)"/.exec(html)?.[1] ?? "";
    const code = await textOf(new URL(script, server.url).href);

    // `.moku/dev.ts` sets the global, and the bunfig define replaced every bare flag.
    expect(code).toContain("globalThis.__MOKU_GAME_DEV__ = true");
    expect(code).not.toContain("typeof __MOKU_GAME_DEV__");
  });

  it("writes the dev page of the fixture under its .moku folder", () => {
    const bunfig = readFileSync(path.join(MINI_GAME, ".moku", "bunfig.toml"), "utf8");

    expect(bunfig).toContain(JSON.stringify(path.join(REPO, "src", "hot.ts")));
    expect(existsSync(path.join(MINI_GAME, ".moku", "main.ts"))).toBe(true);
  });

  it("Ctrl+C stops the child and exits 0", async () => {
    const started = server.started;

    if (started === undefined) throw new Error("The server did not start.");

    expect(await interrupt(started)).toBe(0);
    await expect(fetch(server.url)).rejects.toThrow();
  }, 30_000);
});

describe("moku-game dev on copies of the mini game", () => {
  it("a new scenario file rewrites main.ts with its key", async () => {
    const root = game("dev-scenario");
    const started = startBin(["dev", "--root", root, "--port", "0"]);
    const main = path.join(root, ".moku", "main.ts");

    try {
      await urlOf(started);
      expect(readFileSync(main, "utf8")).toContain('scenarios: { "ready": scenario0 }');

      writeFileSync(
        path.join(root, "tests", "scenarios", "fresh.ts"),
        "export default () => ({ player: { count: 11 } });\n"
      );
      await waitFor(() => readFileSync(main, "utf8").includes('"fresh"'));

      expect(readFileSync(main, "utf8")).toContain(
        'scenarios: { "fresh": scenario0, "ready": scenario1 }'
      );
    } finally {
      expect(await interrupt(started)).toBe(0);
    }
  }, 60_000);

  it("--packed refuses without a pack", async () => {
    const root = game("dev-unpacked");
    const ran = await runBin(["dev", "--root", root, "--packed", "--port", "0"]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      `[game] dev: no packed build in "${path.join(root, "dist", "assets")}".`
    );
    expect(ran.stderr).toContain('Run "moku-game pack" first.');
  }, 60_000);

  it("--packed serves dist/assets after a pack", async () => {
    const root = game("dev-packed");
    const packed = await runBin(["pack", "--root", root]);

    expect(packed.code).toBe(0);

    const started = startBin(["dev", "--root", root, "--packed", "--port", "0"]);

    try {
      const url = await urlOf(started);
      const manifest = JSON.parse(await textOf(`${url}manifest.json`)) as { version: number };

      expect(started.stdout()).toContain("dev server, packed build.");
      expect(manifest.version).toBe(2);
      expect(await statusOf(`${url}features/ui/assets/fx-spark.webp`)).toBe(404);
    } finally {
      expect(await interrupt(started)).toBe(0);
    }
  }, 120_000);

  it("a taken port exits 1 with the --port 0 advice", async () => {
    const root = game("dev-taken");
    const { port, release } = holdPort();

    try {
      const ran = await runBin(["dev", "--root", root, "--port", port]);

      expect(ran.code).toBe(1);
      expect(ran.stderr).toContain(`[game] dev: port ${port} is in use.`);
      expect(ran.stderr).toContain("Pass --port 0 for a free port.");
    } finally {
      await release();
    }
  }, 60_000);
});
