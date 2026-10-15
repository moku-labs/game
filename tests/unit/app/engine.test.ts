/**
 * @file `engineFingerprint`, `engineLine` and `installRootOf` on temp installs: a game folder with
 * the engine under `node_modules/@moku-labs/game` (its `package.json`, `dist/hot.mjs` and a
 * `dist/app/` subfolder), the game's `package.json` with `patchedDependencies`, the patch file and
 * the lock file of the install root.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { engineFingerprint, engineLine, installRootOf } from "../../../src/app/engine";

/** The temp folders of a test, removed after it. */
const made: string[] = [];

/** The installed engine version of the fake installs. */
const VERSION = "0.14.12";

/** The patch file a game declares, relative to the folder of its `package.json`. */
const PATCH = "patches/@moku-labs%2Fgame@0.14.12.patch";

afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/**
 * Writes a file, making its folder first.
 *
 * @param file - The absolute path.
 * @param text - The text.
 */
function put(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Makes a temp folder for one test.
 *
 * @returns The folder.
 */
function temp(): string {
  const folder = mkdtempSync(path.join(tmpdir(), "moku-engine-"));

  made.push(folder);

  return folder;
}

/**
 * Installs a fake engine under a folder's `node_modules`.
 *
 * @param folder - The folder whose `node_modules` gets the engine.
 * @param version - What the engine's `package.json` says its version is.
 * @returns The engine folder and its `dist/hot.mjs`.
 */
function installEngine(
  folder: string,
  version: unknown = VERSION
): { engine: string; hot: string } {
  const engine = path.join(folder, "node_modules", "@moku-labs", "game");

  put(path.join(engine, "package.json"), JSON.stringify({ name: "@moku-labs/game", version }));
  put(path.join(engine, "dist", "hot.mjs"), "export default {};\n");
  put(path.join(engine, "dist", "app", "x.mjs"), "export const x = 1;\n");

  return { engine, hot: path.join(engine, "dist", "hot.mjs") };
}

/**
 * Makes a game that is its own install root: its `package.json`, its lock file and the engine.
 *
 * @param patched - The `patchedDependencies` of its `package.json`.
 * @returns The game folder and the hot plugin.
 */
function gameWith(patched: Record<string, string> = {}): { root: string; hot: string } {
  const root = temp();

  put(
    path.join(root, "package.json"),
    JSON.stringify({ name: "timber", patchedDependencies: patched })
  );
  put(path.join(root, "bun.lock"), "{}\n");
  put(path.join(root, PATCH), "--- a/dist/hot.mjs\n+++ b/dist/hot.mjs\n");

  return { root, hot: installEngine(root).hot };
}

/**
 * The SHA-256 of a text's bytes, hex.
 *
 * @param text - The text.
 * @returns The hash.
 */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("engineFingerprint", () => {
  it("reads the version of the engine the hot plugin resolves to, and hashes its dist into the id", () => {
    const { root, hot } = gameWith();
    const engine = engineFingerprint(root, hot);

    expect(engine.version).toBe(VERSION);
    expect(engine.folder).toBe(path.join(root, "node_modules", "@moku-labs", "game"));
    expect(engine.dist).toMatch(/^[\da-f]{64}$/);
    expect(engine.id).toBe(`${VERSION}+${engine.dist.slice(0, 6)}`);
    expect(engine).not.toHaveProperty("patch");
  });

  it("reads a version that is not a string as unknown", () => {
    const root = temp();
    const { hot } = installEngine(root, 14);

    expect(engineFingerprint(root, hot).version).toBe("unknown");
  });

  it("a changed byte in a dist subfolder, or a renamed file, changes the dist hash and the id", () => {
    const { root, hot } = gameWith();
    const before = engineFingerprint(root, hot);
    const app = path.join(path.dirname(hot), "app");

    writeFileSync(path.join(app, "x.mjs"), "export const x = 2;\n");

    const changed = engineFingerprint(root, hot);

    renameSync(path.join(app, "x.mjs"), path.join(app, "y.mjs"));

    const renamed = engineFingerprint(root, hot);

    expect(changed.dist).not.toBe(before.dist);
    expect(changed.id).not.toBe(before.id);
    expect(renamed.dist).not.toBe(changed.dist);
  });

  it("hashes a patch declared for the installed version into the id, and ignores one for another version", () => {
    const patched = gameWith({ [`@moku-labs/game@${VERSION}`]: PATCH });
    const other = gameWith({ "@moku-labs/game@0.14.11": PATCH });
    const engine = engineFingerprint(patched.root, patched.hot);
    const hash = hashOf("--- a/dist/hot.mjs\n+++ b/dist/hot.mjs\n");

    expect(engine.patch).toEqual({ file: path.join(patched.root, PATCH), hash });
    expect(engine.id).toBe(`${VERSION}+${engine.dist.slice(0, 6)}.patch.${hash.slice(0, 6)}`);
    expect(engineFingerprint(other.root, other.hot)).not.toHaveProperty("patch");
  });

  it("a declared patch file that is missing gives no patch", () => {
    const { root, hot } = gameWith({ [`@moku-labs/game@${VERSION}`]: "patches/gone.patch" });
    const engine = engineFingerprint(root, hot);

    expect(engine).not.toHaveProperty("patch");
    expect(engine.id).not.toContain(".patch.");
  });

  it("finds the patch in the install root above a workspace game, and the walk stops at the lock file", () => {
    const top = temp();
    const game = path.join(top, "games", "timber");
    const { hot } = installEngine(top);
    const outer = temp();
    const inner = path.join(outer, "inner");
    const below = path.join(inner, "game");
    const declared = { patchedDependencies: { [`@moku-labs/game@${VERSION}`]: PATCH } };

    put(path.join(top, "package.json"), JSON.stringify(declared));
    put(path.join(top, "bun.lock"), "{}\n");
    put(path.join(top, PATCH), "a patch\n");
    put(path.join(game, "package.json"), JSON.stringify({ name: "timber" }));
    // The declaration above the install root of `below` is not this install's.
    put(path.join(outer, "package.json"), JSON.stringify(declared));
    put(path.join(outer, PATCH), "a patch\n");
    put(path.join(inner, "bun.lockb"), "");
    mkdirSync(below, { recursive: true });

    expect(engineFingerprint(game, hot).patch?.file).toBe(path.join(top, PATCH));
    expect(engineFingerprint(below, installEngine(inner).hot)).not.toHaveProperty("patch");
    expect(installRootOf(game)).toBe(top);
    expect(installRootOf(below)).toBe(inner);
  });

  it("an engine resolved to its sources is src", () => {
    const root = temp();
    const engine = path.join(root, "engine");

    put(
      path.join(engine, "package.json"),
      JSON.stringify({ name: "@moku-labs/game", version: "0.0.0" })
    );
    put(path.join(engine, "src", "hot.ts"), "export default {};\n");

    expect(engineFingerprint(root, path.join(engine, "src", "hot.ts"))).toEqual({
      id: "0.0.0+src",
      version: "0.0.0",
      dist: "src",
      folder: engine
    });
  });

  it("a hot plugin with no @moku-labs/game package.json above it gives unknown", () => {
    const root = temp();
    const hot = path.join(root, "vendor", "hot.mjs");

    put(
      path.join(root, "vendor", "package.json"),
      JSON.stringify({ name: "other", version: "1.0.0" })
    );
    put(hot, "export default {};\n");

    expect(engineFingerprint(root, hot)).toEqual({
      id: "unknown",
      version: "unknown",
      dist: "unknown",
      folder: path.join(root, "vendor")
    });
  });
});

describe("engineLine", () => {
  it("names the id, and a patched engine its patch file relative to the game, or absolute outside it", () => {
    const engine = {
      id: "0.14.12+9c41e0.patch.3f2a7b",
      version: "0.14.12",
      dist: "9c41e0",
      folder: "/g/node_modules/@moku-labs/game"
    };
    const patch = { file: path.join("/g", PATCH), hash: "3f2a7b" };

    expect(engineLine({ ...engine, id: "0.14.12+9c41e0" }, "/g")).toBe("engine 0.14.12+9c41e0");
    expect(engineLine({ ...engine, patch }, "/g")).toBe(
      `engine 0.14.12+9c41e0.patch.3f2a7b (${PATCH})`
    );
    expect(engineLine({ ...engine, patch }, "/g/games/timber")).toBe(
      `engine 0.14.12+9c41e0.patch.3f2a7b (${path.join("/g", PATCH)})`
    );
  });
});
