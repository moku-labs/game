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
});
