/**
 * @file The production build of the mini game, headless: the committed manifest and generated
 * modules are what the scanner would write again; the fixture is packed into a temp folder with
 * `--pack`, the game plays on the packed manifest, every bundle loads from the pack folder, and
 * `moku-game dev --packed` hands the page the packed build.
 */

import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Assets, Flow } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import miniGame from "../fixtures/mini-game/index";
import { copyMiniGame, removeCopies, type StartedBin, startBin, urlOf } from "./app-helpers";
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
        `${gameRoot}/generated/manifest.json`,
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

/**
 * Stops a started `moku-game dev` the way Ctrl+C does and waits for its end.
 *
 * @param started - The started bin.
 * @returns The exit code.
 */
async function interrupt(started: StartedBin): Promise<number | null> {
  started.child.kill("SIGINT");

  return started.exit;
}

/** What the pack test keeps between its cases: the temp folder and the manifest written there. */
type PackRun = { folder: string; manifest: Assets.Manifest };

/** The packed build of the fixture, made once for the cases below. */
const packed: PackRun = { folder: "", manifest: { version: 1, bundles: {} } };

/** The copies of the mini game the dev server runs on, removed after the file. */
const copies: string[] = [];

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
    removeCopies(copies);
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
    const { app } = miniGame.screen({ manifest: packed.manifest });
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
    const { app } = miniGame.screen({ manifest: packed.manifest, io: disk.io });

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

  it("serves the packed build to the dev page with moku-game dev --packed", async () => {
    const root = copyMiniGame("screen-pack");

    copies.push(root);
    await cp(path.join(packed.folder, "assets"), path.join(root, "dist", "assets"), {
      recursive: true
    });

    const server = startBin(["dev", "--root", root, "--packed", "--port", "0"]);

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
      expect(await interrupt(server)).toBe(0);
    }
  }, 60_000);

  it("refuses --packed without a pack and names the command that makes one", async () => {
    const root = copyMiniGame("screen-unpacked");

    copies.push(root);

    const server = startBin(["dev", "--root", root, "--packed", "--port", "0"]);

    expect(await server.exit).toBe(1);
    expect(server.stderr()).toContain('Run "moku-game pack" first.');
  }, 60_000);
});
