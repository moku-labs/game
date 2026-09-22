/**
 * @file Writes the placeholder tiles of the fixture game: one flat colour PNG per cell, per
 * generator and per chain level of `tables.ts`. No art, no image library — a PNG of one colour is
 * a header, one zlib stream and a checksum. Run it with
 * `bun tests/integration/merge-game/scripts/make-placeholders.ts`, then run the asset scanner.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createBrandConsole } from "@moku-labs/common/cli";
import { tables } from "../tables";

/** The folder the scanner walks: `features/<feature>/assets/`. */
const assetsFolder = fileURLToPath(new URL("../features/board/assets/", import.meta.url));

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

/** The eight bytes every PNG starts with. */
const signature: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Colour type 2: three bytes per pixel, no alpha channel. */
const truecolour = 2;

/**
 * The CRC-32 of a run of bytes, the checksum every PNG chunk carries.
 *
 * @param bytes - The chunk type and its data.
 * @returns The checksum as an unsigned 32-bit number.
 * @example
 * ```ts
 * crc32(Uint8Array.from([0x49, 0x45, 0x4e, 0x44])); // 2923585666, the checksum of IEND
 * ```
 */
function crc32(bytes: Uint8Array): number {
  let remainder = 0xff_ff_ff_ff;

  for (const byte of bytes) {
    remainder ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      remainder = (remainder >>> 1) ^ (0xed_b8_83_20 & -(remainder & 1));
    }
  }

  return (remainder ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Builds one PNG chunk: length, type, data and checksum.
 *
 * @param type - The four-letter chunk type.
 * @param data - The payload of the chunk.
 * @returns The bytes of the chunk.
 */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, data.length);

  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.codePointAt(index) ?? 0;

  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, -4)));

  return bytes;
}

/**
 * Builds the IHDR chunk of a square truecolour image.
 *
 * @param side - Edge length in pixels.
 * @returns The bytes of the chunk.
 */
function header(side: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);

  view.setUint32(0, side);
  view.setUint32(4, side);
  data[8] = 8;
  data[9] = truecolour;

  return chunk("IHDR", data);
}

/**
 * Builds the pixel data of a square of one colour: every scanline carries the filter byte 0 and
 * then its pixels.
 *
 * @param side - Edge length in pixels.
 * @param colour - The colour as `0xRRGGBB`.
 * @returns The raw scanlines, ready to be deflated.
 */
function scanlines(side: number, colour: number): Uint8Array {
  const stride = 1 + side * 3;
  const raw = new Uint8Array(side * stride);
  const red = (colour >> 16) & 0xff;
  const green = (colour >> 8) & 0xff;
  const blue = colour & 0xff;

  for (let row = 0; row < side; row += 1) {
    const start = row * stride;

    for (let column = 0; column < side; column += 1) {
      const pixel = start + 1 + column * 3;

      raw[pixel] = red;
      raw[pixel + 1] = green;
      raw[pixel + 2] = blue;
    }
  }

  return raw;
}

/**
 * Builds a whole PNG file of one colour.
 *
 * @param side - Edge length in pixels.
 * @param colour - The colour as `0xRRGGBB`.
 * @returns The bytes of the file.
 */
function flatPng(side: number, colour: number): Uint8Array {
  const parts = [
    Uint8Array.from(signature),
    header(side),
    chunk("IDAT", new Uint8Array(deflateSync(scanlines(side, colour)))),
    chunk("IEND", new Uint8Array(0))
  ];
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }

  return file;
}

/**
 * Lists every tile the fixture needs: the cell, the generator and one per chain level.
 *
 * @returns The file name and the bytes of each tile.
 */
function tiles(): { name: string; bytes: Uint8Array }[] {
  const list = [
    { name: "cell.png", bytes: flatPng(cellPixels, cellColour) },
    { name: "generator.png", bytes: flatPng(generatorPixels, generatorColour) }
  ];

  for (const [chain, entry] of Object.entries(tables.chains)) {
    for (let level = 1; level <= entry.top; level += 1) {
      const colour = levelColours[level - 1] ?? levelColours.at(-1) ?? cellColour;

      list.push({ name: `item-${chain}-${level}.png`, bytes: flatPng(itemPixels, colour) });
    }
  }

  return list;
}

const written = tiles();

await mkdir(assetsFolder, { recursive: true });

for (const tile of written) {
  await writeFile(path.join(assetsFolder, tile.name), tile.bytes);
}

createBrandConsole().info(
  `placeholders: ${written.length} tiles written to features/board/assets. ` +
    'Run "bun src/assets-scan.ts" next.'
);
