import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: the package bin `moku-game-assets` runs the scanner and the
// string compiler end to end. The real bin is copied into a temp package
// whose `dist/assets.mjs` re-exports `src/assets.ts`, and it runs in a Bun
// child over a one-feature game.
// ---------------------------------------------------------------------------

/** The real bin of the package, the file npm ships. */
const BIN = fileURLToPath(new URL("../../bin/moku-game-assets.mjs", import.meta.url));

/** The door the bin imports through `../dist/assets.mjs`. */
const ASSETS_DOOR = fileURLToPath(new URL("../../src/assets.ts", import.meta.url));

/** A valid 1 x 1 PNG, one opaque pixel. */
const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/**
 * Write a file, making its folder first.
 *
 * @param file - The absolute path.
 * @param contents - The bytes or the text.
 */
function put(file: string, contents: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/**
 * Lay out a temp package with the real bin and a game root with one feature: an image and an
 * English string file.
 *
 * @returns The copied bin and the game root.
 */
function layout(): { bin: string; root: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "moku-assets-bin-"));

  made.push(dir);

  const bin = path.join(dir, "package", "bin", "moku-game-assets.mjs");
  const root = path.join(dir, "game");

  mkdirSync(path.dirname(bin), { recursive: true });
  copyFileSync(BIN, bin);
  put(
    path.join(dir, "package", "dist", "assets.mjs"),
    `export * from ${JSON.stringify(ASSETS_DOOR)};\n`
  );
  put(path.join(root, "features", "ui", "assets", "dot.png"), DOT_PNG);
  put(path.join(root, "features", "ui", "strings", "en.json"), '{ "ui.title": "Merge" }\n');

  return { bin, root };
}

/**
 * Lay out a temp package with the real bin and a game root on the layered layout: a `board`
 * feature with an image and an English string file, and a `shared/` layer with an image, its
 * `assets.ts` and an English string file.
 *
 * @returns The copied bin and the game root.
 */
function layoutWithLayer(): { bin: string; root: string } {
  const { bin, root } = layout();

  rmSync(path.join(root, "features", "ui"), { recursive: true, force: true });
  put(path.join(root, "features", "board", "assets", "cell.png"), DOT_PNG);
  put(path.join(root, "features", "board", "strings", "en.json"), '{ "board.full": "Full" }\n');
  put(path.join(root, "shared", "assets", "button.png"), DOT_PNG);
  // A plain object, as defineBundles builds it, so the temp package needs no engine import.
  put(
    path.join(root, "shared", "assets.ts"),
    'export const uiAssets = { kind: "bundles", map: { ui: { tier: "core" } } };\n'
  );
  put(path.join(root, "shared", "strings", "en.json"), '{ "ui.ok": "OK" }\n');

  return { bin, root };
}

/**
 * Run the bin in a Bun child.
 *
 * @param bin - The copied bin.
 * @param argv - The arguments after the script name.
 * @returns What the child wrote and its exit code.
 */
function runBin(bin: string, argv: string[]): { status: number | null; stderr: string } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const ran = spawnSync("bun", [bin, ...argv], { encoding: "utf8" });

  return { status: ran.status, stderr: ran.stderr };
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the moku-game-assets bin", () => {
  it("scans the assets and compiles the strings of a game", () => {
    const { bin, root } = layout();
    const keys = path.join(root, "generated", "assets.ts");
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
    const ran = spawnSync("bun", [bin, "--root", root, "--keys", keys], { encoding: "utf8" });

    expect(ran.stderr).not.toContain("is not a function");
    expect(ran.status).toBe(0);
    expect(existsSync(keys)).toBe(true);
    expect(readFileSync(keys, "utf8")).toContain("ui.dot");
    expect(existsSync(path.join(root, "generated", "strings.ts"))).toBe(true);
  });

  it("exports the strings for translators", () => {
    const { bin, root } = layout();
    const out = path.join(root, "translations");
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
    const ran = spawnSync("bun", [bin, "--root", root, "--export", out], { encoding: "utf8" });

    expect(ran.stderr).not.toContain("is not a function");
    expect(ran.status).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it("scans a shared layer with --layer and keeps its keys under the mapped name", () => {
    const { bin, root } = layoutWithLayer();
    const keys = path.join(root, "generated", "assets.ts");
    const argv = ["--root", root, "--keys", keys, "--layer", "shared=ui"];
    const ran = runBin(bin, argv);

    expect(ran.stderr).not.toContain("is not a function");
    expect(ran.status).toBe(0);

    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as {
      bundles: Record<string, { feature: string; tier: string; files: { path: string }[] }>;
    };

    expect(readFileSync(keys, "utf8")).toContain('"ui.button"');
    expect(readFileSync(keys, "utf8")).toContain('"board.cell"');
    expect(manifest.bundles.ui?.feature).toBe("ui");
    expect(manifest.bundles.ui?.tier).toBe("core");
    expect(manifest.bundles.ui?.files[0]?.path).toBe("shared/assets/button.png");
    expect(readFileSync(path.join(root, "generated", "strings.en.ts"), "utf8")).toContain("ui.ok");
    expect(runBin(bin, [...argv, "--check"]).status).toBe(0);
  });

  it("exports the strings of the layer", () => {
    const { bin, root } = layoutWithLayer();
    const out = path.join(root, "translations");
    const ran = runBin(bin, ["--root", root, "--export", out, "--layer", "shared=ui"]);

    expect(ran.status).toBe(0);
    expect(readFileSync(path.join(out, "en.json"), "utf8")).toContain("ui.ok");
  });
});
