/**
 * @file Every Chrome the repo launches through Playwright, in the engine, its tests or its scripts,
 * carries the two no-keychain flags of `NO_KEYCHAIN_FLAGS` (F186). Without them Chrome asks the
 * macOS keychain for "Chrome Safe Storage" and a dialog opens over the screen on every run: the
 * pixel leg had it (F186), then `app-hot.test.ts` on every pre-push.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The repo root. */
const REPO = path.resolve(import.meta.dirname, "../../..");

/** The folders that may launch a Chrome. */
const ROOTS = ["src", "tests", "scripts"];

/** A Playwright launch of a browser: `chromium.launch(`, `launchPersistentContext(`, `launchServer(`. */
const LAUNCH = /\.\s*(?:launch|launchPersistentContext|launchServer)\s*\(/u;

/** The folders the walk never enters. */
const SKIPPED = new Set(["node_modules", "dist", ".moku", "fixtures"]);

/**
 * Lists the TypeScript files under a folder.
 *
 * @param folder - The folder, absolute.
 * @returns The files, absolute.
 */
function sourceFiles(folder: string): string[] {
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return [];

  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);

    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sourceFiles(full);

    return /\.tsx?$/u.test(entry.name) ? [full] : [];
  });
}

// The values of NO_KEYCHAIN_FLAGS reach the pixel leg's launch: `leg-browser.test.ts` pins those args.
describe("the Chrome launches of the repo", () => {
  // Bug: a test or a script launches Chrome without the flags, and the keychain dialog opens on every run.
  it("every file that launches a browser through Playwright passes NO_KEYCHAIN_FLAGS", () => {
    const self = path.relative(REPO, import.meta.filename);
    const launching = ROOTS.flatMap(root => sourceFiles(path.join(REPO, root)))
      .map(file => ({ file: path.relative(REPO, file), text: readFileSync(file, "utf8") }))
      .filter(({ file, text }) => file !== self && /chromium/u.test(text) && LAUNCH.test(text));
    const missing = launching
      .filter(({ text }) => !text.includes("NO_KEYCHAIN_FLAGS") && !text.includes("launchChrome("))
      .map(({ file }) => file);

    // The guard has something to guard: the pixel leg and the hot test both launch.
    expect(launching.map(({ file }) => file)).toEqual(
      expect.arrayContaining(["src/visual/leg-browser.ts", "tests/integration/app-hot.test.ts"])
    );
    expect(missing).toEqual([]);
  });
});
