/**
 * @file The tools on a game with sub-features: `moku-game keys --check` on the committed
 * generated files of the episodes game, the owner fields of its dev manifest, the split of its
 * string modules, and a packed build that keeps the owners. The fixture has a parent feature
 * `episodes` with the sub-features `episodes-kit`, `ep01` and `ep02`, and a flat feature `home`.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Assets } from "@moku-labs/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBin } from "./app-helpers";
import { episodesFolder, readEpisodesManifest } from "./episodes-helpers";

const runCommand = promisify(execFile);

/** The repository root, so the scanner is started with the cwd a game would use. */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The episodes game as the tools walk it, relative to the repository root. */
const gameRoot = "tests/fixtures/episodes-game";

/** The owner fields of one bundle; `undefined` where the manifest has no such field. */
type OwnerFields = {
  dir: string | undefined;
  parent: string | undefined;
  release: string | undefined;
};

/**
 * The owner fields of every bundle of a manifest, by bundle name.
 *
 * @param manifest - The manifest.
 * @returns Bundle name to its `dir`, `parent` and `release`.
 */
function ownersOf(manifest: Assets.Manifest): Record<string, OwnerFields> {
  return Object.fromEntries(
    Object.entries(manifest.bundles).map(([name, bundle]) => [
      name,
      { dir: bundle.dir, parent: bundle.parent, release: bundle.release }
    ])
  );
}

/**
 * The keys a generated string module of the fixture holds.
 *
 * @param name - The module file name without `.ts`: `strings.en`, `strings.ep01.ru`.
 * @returns Its keys, sorted.
 */
async function keysOfModule(name: string): Promise<string[]> {
  const loaded = (await import(new URL(`generated/${name}.ts`, episodesFolder).href)) as {
    default: Record<string, unknown>;
  };

  return Object.keys(loaded.default).toSorted();
}

/**
 * Every path a manifest lists: atlas pages, loose files and the pages of a font.
 *
 * @param manifest - The manifest.
 * @returns The paths, relative to the manifest's folder.
 */
function pathsOf(manifest: Assets.Manifest): string[] {
  return Object.values(manifest.bundles).flatMap(bundle => [
    ...(bundle.pages ?? []).map(page => page.path),
    ...bundle.files.flatMap(file => [
      ...(file.path === undefined ? [] : [file.path]),
      ...(file.pages ?? []).map(page => page.path)
    ])
  ]);
}

/**
 * The keys of a bundle's files.
 *
 * @param bundle - The bundle, if the manifest has it.
 * @returns Its keys, sorted.
 */
function keysOf(bundle: Assets.ManifestBundle | undefined): string[] {
  return (bundle?.files ?? []).map(file => file.key).toSorted();
}

describe("episodes-keys — the committed generated files", () => {
  it("the committed generated files are what moku-game keys would write again", async () => {
    const { code, stdout, stderr } = await runBin(["keys", "--check", "--root", gameRoot]);

    expect(code, stderr).toBe(0);
    expect(stdout).toContain("up to date");
    expect(stdout).toContain("in 3 locales (en, en-XA, ru).");
  }, 60_000);

  it("the manifest records each bundle's owner folder, parent, release and mipmaps", async () => {
    const manifest = await readEpisodesManifest();
    const mipmapped = Object.values(manifest.bundles)
      .flatMap(bundle => bundle.files)
      .filter(file => file.mips !== undefined)
      .map(file => [file.key, file.mips]);

    expect(ownersOf(manifest)).toEqual({
      home: {},
      episodes: {},
      "episodes-kit": { dir: "features/episodes/episodes-kit", parent: "episodes" },
      ep01: { dir: "features/episodes/ep01", parent: "episodes", release: "leave" },
      ep02: { dir: "features/episodes/ep02", parent: "episodes" }
    });
    expect(mipmapped).toEqual([["ep01.items.key", true]]);
  });

  it("the whole-game string modules hold no sub-feature key, and each sub-feature module holds only its own", async () => {
    const files = await readdir(new URL("generated/", episodesFolder));
    const modules = files.filter(file => file.startsWith("strings.")).toSorted();
    const locales = ["en", "en-XA", "ru"];

    // The types module, one module per locale for the game, and one per sub-feature with string
    // files and locale; none for episodes-kit, which has no strings.
    expect(modules).toEqual(
      [
        "strings.ts",
        ...locales.map(locale => `strings.${locale}.ts`),
        ...["ep01", "ep02"].flatMap(name => locales.map(locale => `strings.${name}.${locale}.ts`))
      ].toSorted()
    );

    for (const locale of locales) {
      expect(await keysOfModule(`strings.${locale}`), locale).toEqual([
        "episodes.title",
        "home.play"
      ]);
      expect(await keysOfModule(`strings.ep01.${locale}`), locale).toEqual(["ep01.title"]);
      expect(await keysOfModule(`strings.ep02.${locale}`), locale).toEqual(["ep02.title"]);
    }
  });
});

/** The packed build of the fixture, made once for the case below. */
const packed = { folder: "", manifest: { version: 1, bundles: {} } as Assets.Manifest };

describe("episodes-keys — the packed build", () => {
  beforeAll(async () => {
    packed.folder = await mkdtemp(path.join(tmpdir(), "episodes-game-pack-"));

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

    packed.manifest = JSON.parse(
      await readFile(path.join(packed.folder, "assets/manifest.json"), "utf8")
    ) as Assets.Manifest;
  }, 120_000);

  afterAll(async () => {
    await rm(packed.folder, { recursive: true, force: true });
  });

  it("the packed build keeps the owners and every packed file exists", async () => {
    const dev = await readEpisodesManifest();
    const missing: string[] = [];

    for (const file of pathsOf(packed.manifest)) {
      const found = await stat(path.join(packed.folder, "assets", file)).catch(() => undefined);

      if (found?.isFile() !== true) missing.push(file);
    }

    expect(packed.manifest.version).toBe(2);
    expect(ownersOf(packed.manifest)).toEqual(ownersOf(dev));
    expect(pathsOf(packed.manifest).length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
    expect(keysOf(packed.manifest.bundles.ep01)).toEqual(keysOf(dev.bundles.ep01));
  });
});
