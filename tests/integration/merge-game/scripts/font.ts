/**
 * @file The placeholder fonts of the fixture game: a BMFont page drawn from 5×7 patterns and the
 * `.fnt` that names it. No art and no font file — the digits carry real shapes, because the coin
 * counter is read in the browser, and every other glyph is a box, because nothing reads it.
 */

import { maskPng } from "./png";

/** Edge length of one glyph cell on the page, in texture pixels. */
const CELL = 32;

/** Glyph cells per row of the page. */
const COLUMNS = 16;

/** How many page pixels one pattern pixel takes. */
const SCALE = 4;

/** Where a 5×7 pattern starts inside its 32×32 cell. */
const INSET = { x: 6, y: 2 };

/** Width and height of the pattern grid, in pattern pixels. */
const PATTERN = { width: 5, height: 7 };

/** Em size of both fonts: the size a style of 32 draws one to one. */
const FONT_SIZE = 32;

/** Distance between two baselines, in font pixels. */
const LINE_HEIGHT = 40;

/** How far the baseline sits below the top of a line. */
const BASE = 32;

/** What a glyph with a shape advances by. */
const GLYPH_ADVANCE = 24;

/** What a space advances by. */
const SPACE_ADVANCE = 12;

/** What a punctuation mark advances by. */
const MARK_ADVANCE = 14;

/** A letter of any alphabet, so a box is drawn for it. */
const LETTER = /\p{L}/u;

/** The ten digits, drawn for real: the coin counter is read on the screen. */
const digitPatterns: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"]
};

/** Every letter: an open box, the shape a placeholder font has. */
const boxPattern: readonly string[] = [
  "01110",
  "10001",
  "10001",
  "10001",
  "10001",
  "10001",
  "01110"
];

/** Every punctuation mark: a small block on the baseline. */
const markPattern: readonly string[] = [
  "00000",
  "00000",
  "00000",
  "00000",
  "00000",
  "01100",
  "01100"
];

/** Nothing at all, for the space. */
const blankPattern: readonly string[] = [
  "00000",
  "00000",
  "00000",
  "00000",
  "00000",
  "00000",
  "00000"
];

/**
 * One font as this script writes it: the two files and the page size the `.fnt` declares.
 *
 * @example
 * ```ts
 * const font: PlaceholderFont = { fnt: "{}", page: new Uint8Array(0), pageName: "font-body_0.png" };
 * ```
 */
export type PlaceholderFont = { fnt: string; page: Uint8Array; pageName: string };

/**
 * The characters the body font carries: Latin, Cyrillic, digits and the marks the strings of
 * this game use. Cyrillic is written out whole, so a Russian message never hits a missing glyph.
 *
 * @returns The characters, in page order.
 * @example
 * ```ts
 * bodyCharacters().includes("ж"); // true
 * ```
 */
export function bodyCharacters(): string[] {
  const digits = [..."0123456789"];
  const latin = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];
  const cyrillic = [..."АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя"];
  const marks = [...` .,:;!?+-%()/'"×`];

  return [...digits, ...latin, ...cyrillic, ...marks];
}

/**
 * The characters the digits font carries: what a counter and a price are written with.
 *
 * @returns The characters, in page order.
 * @example
 * ```ts
 * digitCharacters().length; // 15
 * ```
 */
export function digitCharacters(): string[] {
  return [...`0123456789 +-×`];
}

/**
 * The 5×7 pattern of one character.
 *
 * @param character - The character to draw.
 * @returns Seven rows of five `0` or `1`.
 * @example
 * ```ts
 * patternOf("1")[0]; // "00100"
 * ```
 */
function patternOf(character: string): readonly string[] {
  if (character === " ") return blankPattern;

  return digitPatterns[character] ?? (LETTER.test(character) ? boxPattern : markPattern);
}

/**
 * What one character advances the pen by.
 *
 * @param character - The character to measure.
 * @returns The advance in font pixels.
 * @example
 * ```ts
 * advanceOf(" "); // 12
 * ```
 */
function advanceOf(character: string): number {
  if (character === " ") return SPACE_ADVANCE;

  return LETTER.test(character) || digitPatterns[character] !== undefined
    ? GLYPH_ADVANCE
    : MARK_ADVANCE;
}

/**
 * Draws one pattern into the page mask.
 *
 * @param mask - The page mask, one alpha byte per pixel.
 * @param width - Width of the page in pixels.
 * @param origin - Top-left pixel of the glyph cell.
 * @param origin.x - Left edge of the cell.
 * @param origin.y - Top edge of the cell.
 * @param pattern - The rows of the character.
 */
function draw(
  mask: Uint8Array,
  width: number,
  origin: { x: number; y: number },
  pattern: readonly string[]
): void {
  for (let row = 0; row < PATTERN.height; row += 1) {
    const line = pattern[row] ?? "";

    for (let column = 0; column < PATTERN.width; column += 1) {
      if (line[column] !== "1") continue;

      for (let y = 0; y < SCALE; y += 1) {
        for (let x = 0; x < SCALE; x += 1) {
          const pixelX = origin.x + INSET.x + column * SCALE + x;
          const pixelY = origin.y + INSET.y + row * SCALE + y;

          mask[pixelY * width + pixelX] = 0xff;
        }
      }
    }
  }
}

/**
 * One `<char>` line of the BMFont file.
 *
 * @param character - The character this glyph draws.
 * @param origin - Top-left pixel of its cell.
 * @param origin.x - Left edge of the cell.
 * @param origin.y - Top edge of the cell.
 * @returns The line, without its indent.
 * @example
 * ```ts
 * charLine("0", { x: 0, y: 0 }).startsWith('<char id="48"'); // true
 * ```
 */
function charLine(character: string, origin: { x: number; y: number }): string {
  const fields = [
    `id="${character.codePointAt(0) ?? 0}"`,
    `x="${origin.x}"`,
    `y="${origin.y}"`,
    `width="${CELL}"`,
    `height="${CELL}"`,
    'xoffset="0"',
    `yoffset="${BASE - CELL}"`,
    `xadvance="${advanceOf(character)}"`,
    'page="0"',
    'chnl="15"'
  ];

  return `<char ${fields.join(" ")} />`;
}

/**
 * Builds one placeholder font: the page as a PNG and the BMFont XML that names it. Every glyph is
 * one cell of the page, so a character is found by its index. XML is the format both readers of
 * this engine take — the measurement table and Pixi's font parser.
 *
 * @param stem - File name of the font without its extension, for example `font-body`.
 * @param characters - The characters the font carries, in page order.
 * @returns The `.fnt` text, the page bytes and the page file name.
 * @example
 * ```ts
 * placeholderFont("font-digits", ["0"]).pageName; // "font-digits_0.png"
 * ```
 */
export function placeholderFont(stem: string, characters: readonly string[]): PlaceholderFont {
  const rows = Math.ceil(characters.length / COLUMNS);
  const width = COLUMNS * CELL;
  const height = rows * CELL;
  const mask = new Uint8Array(width * height);
  const pageName = `${stem}_0.png`;
  const lines = characters.map((character, index) => {
    const origin = { x: (index % COLUMNS) * CELL, y: Math.floor(index / COLUMNS) * CELL };

    draw(mask, width, origin, patternOf(character));

    return `    ${charLine(character, origin)}`;
  });
  const fnt = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<font>",
    `  <info face="${stem}" size="${FONT_SIZE}" />`,
    `  <common lineHeight="${LINE_HEIGHT}" base="${BASE}" scaleW="${width}" scaleH="${height}" pages="1" />`,
    "  <pages>",
    `    <page id="0" file="${pageName}" />`,
    "  </pages>",
    `  <chars count="${characters.length}">`,
    ...lines,
    "  </chars>",
    "</font>",
    ""
  ].join("\n");

  return { fnt, page: maskPng(width, height, mask), pageName };
}
