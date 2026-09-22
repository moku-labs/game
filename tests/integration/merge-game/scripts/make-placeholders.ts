/**
 * @file Writes every placeholder asset of the fixture game: one flat colour PNG per cell, per
 * generator and per chain level of `tables.ts`, the two BMFont pages of the interface, and three
 * short tones as `.mp3`. No art and no recording. Run it with
 * `bun tests/integration/merge-game/scripts/make-placeholders.ts`, then run the asset scanner.
 *
 * The tones need `ffmpeg` on the PATH. Without it the three sounds are left as they are, and the
 * script says so: the committed files are good enough for every test.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createBrandConsole } from "@moku-labs/common/cli";
import { tables } from "../tables";
import { bodyCharacters, digitCharacters, placeholderFont } from "./font";
import { flatPng } from "./png";

const runCommand = promisify(execFile);

/** The folder of the game, the one every asset path below starts from. */
const gameFolder = fileURLToPath(new URL("../", import.meta.url));

/** Edge length of a cell tile in texture pixels. A board cell is 240 reference units wide. */
const cellPixels = 192;

/** Edge length of an item tile: smaller than a cell, so the grid stays visible behind it. */
const itemPixels = 144;

/** Edge length of the generator tile. */
const generatorPixels = 168;

/** The colour of an empty cell. */
const cellColour = 0x2a_33_42;

/** The colour of the generator. */
const generatorColour = 0xc9_8b_2e;

/** One colour per chain level, lowest first. A chain longer than this repeats the last colour. */
const levelColours: readonly number[] = [
  0x6e_cb_63, 0x3f_a9_f5, 0xf5_5f_5f, 0xb0_6e_f5, 0xf5_c8_42
];

/** One file this script writes, with its path inside the game folder. */
type Written = { file: string; bytes: Uint8Array };

/** One tone, with the ffmpeg source that makes it. */
type Tone = { file: string; source: string };

/** The three sounds of the game: the button, the finished order and the music of the board. */
const tones: readonly Tone[] = [
  { file: "features/ui/assets/click.mp3", source: "sine=frequency=1200:duration=0.07" },
  { file: "features/orders/assets/complete.mp3", source: "sine=frequency=660:duration=0.35" },
  { file: "features/board/assets/theme.mp3", source: "sine=frequency=220:duration=2" }
];

/**
 * Lists every tile the fixture needs: the cell, the generator and one per chain level.
 *
 * @returns The path and the bytes of each tile.
 */
function tiles(): Written[] {
  const list: Written[] = [
    { file: "features/board/assets/cell.png", bytes: flatPng(cellPixels, cellColour) },
    {
      file: "features/board/assets/generator.png",
      bytes: flatPng(generatorPixels, generatorColour)
    }
  ];

  for (const [chain, entry] of Object.entries(tables.chains)) {
    for (let level = 1; level <= entry.top; level += 1) {
      const colour = levelColours[level - 1] ?? levelColours.at(-1) ?? cellColour;

      list.push({
        file: `features/board/assets/item-${chain}-${level}.png`,
        bytes: flatPng(itemPixels, colour)
      });
    }
  }

  return list;
}

/**
 * The two fonts of the interface: the body font with every letter the strings use, and the digits
 * font of the coin counter. Each one is a `.fnt` and the page it names.
 *
 * @returns The path and the bytes of each file.
 */
function fonts(): Written[] {
  const encoder = new TextEncoder();
  const list: Written[] = [];
  const wanted = [
    { stem: "font-body", characters: bodyCharacters() },
    { stem: "font-digits", characters: digitCharacters() }
  ];

  for (const entry of wanted) {
    const font = placeholderFont(entry.stem, entry.characters);

    list.push(
      { file: `features/ui/assets/${entry.stem}.fnt`, bytes: encoder.encode(font.fnt) },
      { file: `features/ui/assets/${font.pageName}`, bytes: font.page }
    );
  }

  return list;
}

/**
 * Writes one file, creating its folder.
 *
 * @param written - The path inside the game folder and the bytes.
 */
async function write(written: Written): Promise<void> {
  const target = path.join(gameFolder, written.file);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, written.bytes);
}

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

const images = [...tiles(), ...fonts()];

for (const file of images) await write(file);

const sounds = await writeTones();

createBrandConsole().info(
  `placeholders: ${images.length} images written. ` +
    (sounds === tones.length
      ? `${sounds} tones written. Run "bun src/assets.ts" next.`
      : "ffmpeg is missing, the committed tones were kept.")
);
