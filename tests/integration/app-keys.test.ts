/**
 * @file `watchKeys`, the editor's seam of `@moku-labs/game/cli`, on copies of the mini game in the
 * engine repo, with the real scanner, the real `fs.watch` and the branded console: `generated/`
 * written before it resolves, a strings save and an image save picked up, a broken strings file
 * handed to `onError` and its fix scanned again. The platform watcher is trusted on macOS only;
 * the batch rules run on every platform in `tests/unit/app-keys.test.ts`. A test writes right
 * after a scan, with no wait: Bun reports only the first path of a burst of writes, so such a save
 * may not be heard, and the trailing batch of the scan is what finds it.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type KeysWatcher, watchKeys } from "../../src/cli";
import { copyMiniGame, removeCopies } from "./app-helpers";

/** How much longer a slow box may take: every window of this file is multiplied by it. */
const TIMING_SLACK = Number(process.env.PROJECT_TIMING_SLACK ?? 1);

/** How long a test waits for a scan before it fails. */
const WAIT_MS = 8000 * TIMING_SLACK;

/** The English strings of the mini game, under the game folder. */
const ENGLISH = "features/home/strings/en.json";

/** An image of the mini game, under the game folder. */
const SPARK = "features/ui/assets/fx-spark.webp";

/** The copies of this file, removed after it. */
const copies: string[] = [];

/** The watches of a test, closed after it. */
const opened: KeysWatcher[] = [];

/**
 * Copies the mini game for one test. The path is real: the watcher reports events under it.
 *
 * @returns The copy.
 */
function game(): string {
  const copy = realpathSync(copyMiniGame("keys"));

  copies.push(copy);

  return copy;
}

/**
 * Starts the watch of a game; the test may write at once.
 *
 * @param root - The game folder.
 * @param onError - Gets the message of a failed scan.
 * @returns Resolves when the first scan ended.
 */
async function watched(root: string, onError?: (message: string) => void): Promise<void> {
  opened.push(await watchKeys(root, onError === undefined ? {} : { onError }));
}

/**
 * Reads a file of a game.
 *
 * @param root - The game folder.
 * @param file - The path under it.
 * @returns The text.
 */
function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

/**
 * Reads when a file of a game was written last.
 *
 * @param root - The game folder.
 * @param file - The path under it.
 * @returns The time stamp in milliseconds.
 */
function writtenAt(root: string, file: string): number {
  return statSync(path.join(root, file)).mtimeMs;
}

/**
 * The stamp the watch gives a file as it is on disk now.
 *
 * @param root - The game folder.
 * @param file - The path under it.
 * @returns `<size>:<mtimeMs>`.
 */
function stampOf(root: string, file: string): string {
  const stats = statSync(path.join(root, file));

  return `${stats.size}:${stats.mtimeMs}`;
}

afterEach(() => {
  for (const keys of opened.splice(0)) keys.close();
});

afterAll(() => {
  removeCopies(copies);
});

describe.skipIf(typeof Bun === "undefined")("watchKeys on a folder that is not a game", () => {
  it("rejects with the [game] error of moku-game dev, as preparePage does", async () => {
    const root = game();

    rmSync(path.join(root, "config.ts"));
    rmSync(path.join(root, "generated"), { recursive: true });

    await expect(watchKeys(root)).rejects.toThrow(
      new Error(
        `[game] moku-game: no config.ts in "${root}".\n  A game keeps its page, native, system, save and assets data there.`
      )
    );
    expect(existsSync(path.join(root, "generated"))).toBe(false);
    expect(existsSync(path.join(root, ".moku"))).toBe(false);
  });
});

describe.skipIf(typeof Bun === "undefined" || process.platform !== "darwin")(
  "watchKeys on a copy of the mini game",
  { timeout: WAIT_MS * 3 },
  () => {
    it("writes generated/assets.ts, generated/manifest.json and the stamp before it resolves", async () => {
      const root = game();

      rmSync(path.join(root, "generated"), { recursive: true });
      opened.push(await watchKeys(path.relative(process.cwd(), root)));

      expect(existsSync(path.join(root, "generated", "assets.ts"))).toBe(true);
      expect(existsSync(path.join(root, "generated", "manifest.json"))).toBe(true);
      expect(read(root, "generated/strings.en.ts")).toContain("Tap the");
      expect(read(root, ".moku/assets-stamp.ts")).toMatch(
        /^\/\/ Written by moku-game dev\. Do not edit\.\nexport default \{\n {2}files: \{\n/
      );
      expect(read(root, ".moku/assets-stamp.ts")).toContain(
        `    "${SPARK}": "${stampOf(root, SPARK)}"`
      );
      expect(read(root, ".moku/assets-stamp.ts")).toMatch(/\n {2}changed: \[\]\n\};\n$/);
    });

    it("rewrites generated/strings.en.ts for a changed string value, and not the stamp", async () => {
      const root = game();
      const lines: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
        lines.push(String(line));
      });

      try {
        await watched(root);

        const stamp = writtenAt(root, ".moku/assets-stamp.ts");
        const keys = writtenAt(root, "generated/assets.ts");

        writeFileSync(path.join(root, ENGLISH), '{\n  "home.note": "Tap the button"\n}\n');

        // The line comes after the scan, and the batch writes a stamp right after it, if at all.
        await vi.waitFor(
          () =>
            expect(lines.filter(line => line.includes("keys: "))).toEqual([
              expect.stringContaining(`keys: ${ENGLISH}`)
            ]),
          { timeout: WAIT_MS }
        );

        expect(read(root, "generated/strings.en.ts")).toContain('text: "Tap the button"');
        expect(writtenAt(root, ".moku/assets-stamp.ts")).toBe(stamp);
        expect(writtenAt(root, "generated/assets.ts")).toBe(keys);
      } finally {
        log.mockRestore();
      }
    });

    it("rewrites the stamp for new bytes in an existing image with that image as changed, and not generated/assets.ts", async () => {
      const root = game();

      await watched(root);

      const stamp = read(root, ".moku/assets-stamp.ts");
      const keys = writtenAt(root, "generated/assets.ts");
      const manifest = read(root, "generated/manifest.json");

      appendFileSync(path.join(root, SPARK), Buffer.from([0, 0]));

      // The stamp is written after the scan, so the scan wrote what it had to write by then.
      await vi.waitFor(() => expect(read(root, ".moku/assets-stamp.ts")).not.toBe(stamp), {
        timeout: WAIT_MS
      });

      // The stamp names the image with its new size, and nothing else as changed.
      expect(read(root, ".moku/assets-stamp.ts")).toContain(
        `    "${SPARK}": "${stampOf(root, SPARK)}"`
      );
      expect(read(root, ".moku/assets-stamp.ts")).toMatch(
        new RegExp(String.raw`\n {2}changed: \["${SPARK}"\]\n\};\n$`)
      );
      expect(writtenAt(root, "generated/assets.ts")).toBe(keys);
      expect(read(root, "generated/manifest.json")).toBe(manifest);
    });

    it("calls onError for a broken strings/en.json, and scans again when it is fixed", async () => {
      const root = game();
      const onError = vi.fn();

      await watched(root, onError);
      writeFileSync(path.join(root, ENGLISH), '{\n  "home.note": "Tap the button"\n');

      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1), { timeout: WAIT_MS });

      // The reason after the colon is the JSON parser's own sentence, so only the start is pinned.
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining(`[game] i18n: ${ENGLISH} could not be read: `)
      );
      expect(read(root, "generated/strings.en.ts")).toContain("Tap the <icon=ui.fx-spark>");

      writeFileSync(path.join(root, ENGLISH), '{\n  "home.note": "Fixed"\n}\n');

      await vi.waitFor(
        () => expect(read(root, "generated/strings.en.ts")).toContain('text: "Fixed"'),
        { timeout: WAIT_MS }
      );

      expect(onError).toHaveBeenCalledTimes(1);
    });
  }
);
