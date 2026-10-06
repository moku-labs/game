/**
 * @file The production build of the mini game, headless: the committed manifest and generated
 * modules are what the scanner would write again; the fixture is packed into a temp folder with
 * `--pack`, the game plays on the packed manifest, every bundle loads from the pack folder, and
 * the dev server hands the page the packed build with `--packed`.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Assets, Flow } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiniGame } from "../fixtures/mini-game/game";
import { folderIo, miniFolder, startOnHome } from "./mini-helpers";

const runCommand = promisify(execFile);

/** The repository root, so the scanner is started with the cwd a game would use. */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The mini game as the scanner walks it: the folder that holds `features/`. */
const gameRoot = "tests/fixtures/mini-game";

/** Open the info popup, say OK, and come back to Home with the counter one up. */
const okRoute: Flow.RouteStep[] = [
  { at: "home", intent: "info" },
  { at: "info/show", intent: "ok" }
];

/**
 * Reads the asset keys the scanner wrote into a key module: the members of `AssetKey`.
 *
 * @param source - The text of the key module.
 * @returns The keys, in the order of the module.
 */
function assetKeysOf(source: string): string[] {
  const union = /export type AssetKey =([^;]*);/.exec(source)?.[1] ?? "";

  return [...union.matchAll(/"([^"]+)"/g)].map(match => match[1] ?? "");
}

/**
 * Every file of a manifest, with the bundle that lists it.
 *
 * @param manifest - The manifest.
 * @returns The files, bundle by bundle.
 */
function filesOf(manifest: Assets.Manifest): { bundle: string; file: Assets.ManifestFile }[] {
  return Object.entries(manifest.bundles).flatMap(([bundle, entry]) =>
    entry.files.map(file => ({ bundle, file }))
  );
}

describe("screen-pack — the generated asset keys", () => {
  it("has a manifest, a key module and string modules, en-XA included, the scanner would write again", async () => {
    const { stdout } = await runCommand(
      "bun",
      [
        "src/assets.ts",
        "--root",
        gameRoot,
        "--manifest",
        `${gameRoot}/manifest.json`,
        "--keys",
        `${gameRoot}/generated/assets.ts`,
        "--check",
        "--pseudo"
      ],
      { cwd: repoRoot }
    );

    expect(stdout).toContain("up to date");
    expect(stdout).toContain("in 3 locales (en, en-XA, ru).");
  }, 60_000);
});

/** A dev server of the fixture page started by a test, and everything it printed so far. */
type Server = { child: ChildProcess; printed: () => string };

/**
 * Starts the dev server of the fixture page from the fixture's folder, as a person does.
 *
 * @param args - The flags after the script.
 * @returns The process and what it printed.
 */
function launchServer(args: readonly string[]): Server {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const child = spawn("bun", ["./web/serve.ts", ...args], { cwd: fileURLToPath(miniFolder) });
  const chunks: string[] = [];
  const keep = (chunk: Buffer): void => {
    chunks.push(chunk.toString("utf8"));
  };

  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  return { child, printed: () => chunks.join("") };
}

/**
 * Waits for the line in which the server names its URL.
 *
 * @param server - The started server.
 * @returns The URL, ending in `/`.
 */
function urlOf(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.child.stdout?.on("data", () => {
      const url = /https?:\/\/\S+\//.exec(server.printed())?.[0];

      if (url !== undefined) resolve(url);
    });
    server.child.on("close", code => {
      reject(new Error(`serve.ts ended with ${code}: ${server.printed()}`));
    });
  });
}

/**
 * Waits for the server to end.
 *
 * @param server - The started server.
 * @returns The exit code.
 */
function exitOf(server: Server): Promise<number | null> {
  return new Promise(resolve => {
    server.child.on("close", resolve);
  });
}

/** What the pack test keeps between its cases: the temp folder and the manifest written there. */
type PackRun = { folder: string; manifest: Assets.Manifest };

/** The packed build of the fixture, made once for the cases below. */
const packed: PackRun = { folder: "", manifest: { version: 1, bundles: {} } };

describe("screen-pack — the packed build", () => {
  beforeAll(async () => {
    packed.folder = await mkdtemp(path.join(tmpdir(), "mini-game-pack-"));

    await runCommand(
      "bun",
      [
        "src/assets.ts",
        "--root",
        gameRoot,
        "--keys",
        path.join(packed.folder, "generated/assets.ts"),
        "--pack",
        path.join(packed.folder, "assets")
      ],
      { cwd: repoRoot }
    );

    const text = await readFile(path.join(packed.folder, "assets/manifest.json"), "utf8");

    packed.manifest = JSON.parse(text) as Assets.Manifest;
  }, 120_000);

  afterAll(async () => {
    await rm(packed.folder, { recursive: true, force: true });
  });

  it("packs every key of the game once, with the same key module as a dev run", async () => {
    const committed = await readFile(new URL("generated/assets.ts", miniFolder));
    const written = await readFile(path.join(packed.folder, "generated/assets.ts"));
    const keys = filesOf(packed.manifest).map(entry => entry.file.key);

    expect(packed.manifest.version).toBe(2);
    expect(written.equals(committed)).toBe(true);
    expect(keys.toSorted()).toEqual(assetKeysOf(committed.toString("utf8")).toSorted());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("writes every file of the ui bundle under a hashed name: the font, its page, the spark and the sound", () => {
    const ui = packed.manifest.bundles.ui;
    const byKey = new Map((ui?.files ?? []).map(file => [file.key, file]));

    expect(ui?.tier).toBe("boot");
    // One texture is a group of one: it stays loose, so no atlas page is written.
    expect(ui?.pages).toBeUndefined();
    expect(byKey.get("ui.fx-spark")?.path).toMatch(/^ui\/ui\.fx-spark-[0-9a-f]{10}\.webp$/);
    expect(byKey.get("ui.popup")?.path).toMatch(/^ui\/ui\.popup-[0-9a-f]{10}\.mp3$/);
    expect(byKey.get("ui.font-body")?.path).toMatch(/^ui\/ui\.font-body-[0-9a-f]{10}\.fnt$/);
    expect(byKey.get("ui.font-body")?.pages?.map(page => page.path)).toEqual([
      expect.stringMatching(/^ui\/ui\.font-body-0-[0-9a-f]{10}\.png$/)
    ]);
  });

  it("plays the game on the packed manifest, every bundle loaded", async () => {
    const app = createMiniGame({ manifest: packed.manifest });
    const game = await createHeadless(app);

    for (const bundle of Object.keys(packed.manifest.bundles)) {
      expect(app.assets.isLoaded(bundle), bundle).toBe(true);
    }

    const home = await game.walk(okRoute);

    expect(home.path).toBe("home");
    expect(app.model.store.snapshot().player).toEqual({ count: 1 });

    await game.stop();
  });

  it("loads every bundle from the pack folder: each file fetched once, the font from the rewritten .fnt", async () => {
    const disk = folderIo(pathToFileURL(`${path.join(packed.folder, "assets")}/`));
    const app = createMiniGame({ manifest: packed.manifest, io: disk.io });

    await startOnHome(app);
    await Promise.all(Object.keys(packed.manifest.bundles).map(bundle => app.assets.load(bundle)));

    const files = filesOf(packed.manifest).flatMap(({ file }) => [
      ...(file.path === undefined ? [] : [file.path]),
      ...(file.pages ?? []).map(page => page.path)
    ]);

    expect(disk.fetched.toSorted()).toEqual(files.toSorted());
    expect(disk.slices).toEqual([]);

    const spark = packed.manifest.bundles.ui?.files.find(file => file.key === "ui.fx-spark");

    expect(app.assets.texture("ui.fx-spark")).toEqual({ path: spark?.path });
    expect(app.assets.font("ui.font-body")?.fnt).toMatch(
      /file="ui\.font-body-0-[0-9a-f]{10}\.png"/
    );
    expect(app.assets.audio("ui.popup")?.mime).toBe("audio/mpeg");

    await app.stop();
  });

  it("serves the packed build to the dev page with --packed", async () => {
    const server = launchServer(["--packed", path.join(packed.folder, "assets"), "--port", "0"]);

    try {
      const url = await urlOf(server);
      const served = await fetch(`${url}manifest.json`);
      const spark = packed.manifest.bundles.ui?.files.find(file => file.key === "ui.fx-spark");
      const image = await fetch(`${url}${spark?.path ?? ""}`);
      const bytes = Buffer.from(await image.arrayBuffer());
      const loose = await fetch(`${url}features/ui/assets/font-body.fnt`);
      const html = await fetch(url);

      expect(await served.json()).toEqual(packed.manifest);
      expect(image.status).toBe(200);
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      // The loose dev files are not part of the packed build.
      expect(loose.status).toBe(404);
      expect(await html.text()).toContain('<div id="game"></div>');
    } finally {
      server.child.kill();
    }
  }, 60_000);

  it("refuses --packed without a pack and names the script that makes one", async () => {
    const server = launchServer(["--packed", path.join(packed.folder, "missing"), "--port", "0"]);

    expect(await exitOf(server)).toBe(1);
    expect(server.printed()).toContain('Run "bun run mini:pack"');
  }, 60_000);
});
