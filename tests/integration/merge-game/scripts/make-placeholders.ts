/**
 * @file Writes the placeholder sounds of the fixture game: three short tones as `.mp3`, no
 * recording. The art and the fonts are real files drawn for Timber Town (see
 * `features/ui/assets/ASSETS.md`), so the sounds are the only placeholders left. Run it with
 * `bun tests/integration/merge-game/scripts/make-placeholders.ts`, then run the asset scanner.
 *
 * The tones need `ffmpeg` on the PATH. Without it the three sounds are left as they are, and the
 * script says so: the committed files are good enough for every test.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createBrandConsole } from "@moku-labs/common/cli";

const runCommand = promisify(execFile);

/** The folder of the game, the one every asset path below starts from. */
const gameFolder = fileURLToPath(new URL("../", import.meta.url));

/** One tone, with the ffmpeg source that makes it. */
type Tone = { file: string; source: string };

/** The three sounds of the game: the button, the finished order and the music of the board. */
const tones: readonly Tone[] = [
  { file: "features/ui/assets/click.mp3", source: "sine=frequency=1200:duration=0.07" },
  { file: "features/orders/assets/complete.mp3", source: "sine=frequency=660:duration=0.35" },
  { file: "features/board/assets/theme.mp3", source: "sine=frequency=220:duration=2" }
];

/**
 * Writes the three tones with ffmpeg, mono and at the lowest bitrate that still decodes
 * everywhere, so every file stays a few kilobytes.
 *
 * @returns How many files were written; fewer than three when ffmpeg is not on the PATH.
 */
async function writeTones(): Promise<number> {
  let written = 0;

  for (const tone of tones) {
    const target = path.join(gameFolder, tone.file);

    await mkdir(path.dirname(target), { recursive: true });

    try {
      await runCommand("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        tone.source,
        "-ac",
        "1",
        "-ar",
        "22050",
        "-b:a",
        "32k",
        target
      ]);
      written += 1;
    } catch {
      return written;
    }
  }

  return written;
}

const sounds = await writeTones();

createBrandConsole().info(
  sounds === tones.length
    ? `placeholders: ${sounds} tones written. Run "bun src/assets.ts" next.`
    : "placeholders: ffmpeg is missing, the committed tones were kept."
);
