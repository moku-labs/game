/**
 * @file The PNG encoder of the placeholder scripts: a header, one deflated pixel stream and a
 * checksum. No image library — a placeholder is a flat colour or a mask of white pixels, and both
 * fit in a few lines. Used by `make-placeholders.ts` for the tiles and for the font pages.
 */

import { deflateSync } from "node:zlib";

/** The eight bytes every PNG starts with. */
const signature: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Colour type 2: three bytes per pixel, no alpha channel. */
const TRUECOLOUR = 2;

/** Colour type 6: four bytes per pixel, the last one alpha. */
const TRUECOLOUR_ALPHA = 6;

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
 * Builds the IHDR chunk of an image.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param colourType - 2 for RGB, 6 for RGBA.
 * @returns The bytes of the chunk.
 */
function header(width: number, height: number, colourType: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);

  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8;
  data[9] = colourType;

  return chunk("IHDR", data);
}

/**
 * Joins the parts of a file into one buffer.
 *
 * @param parts - The chunks, in file order.
 * @returns The bytes of the file.
 */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }

  return file;
}

/**
 * Wraps raw scanlines into a whole PNG file.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param colourType - 2 for RGB, 6 for RGBA.
 * @param raw - The scanlines, each one led by its filter byte.
 * @returns The bytes of the file.
 */
function pngOf(width: number, height: number, colourType: number, raw: Uint8Array): Uint8Array {
  return joined([
    Uint8Array.from(signature),
    header(width, height, colourType),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0))
  ]);
}

/**
 * Builds a square PNG of one colour.
 *
 * @param side - Edge length in pixels.
 * @param colour - The colour as `0xRRGGBB`.
 * @returns The bytes of the file.
 * @example
 * ```ts
 * flatPng(2, 0xff0000).length; // 76: a two-pixel red square
 * ```
 */
export function flatPng(side: number, colour: number): Uint8Array {
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

  return pngOf(side, side, TRUECOLOUR, raw);
}

/**
 * Builds a white PNG whose alpha channel is the mask: one byte per pixel, row by row. It is what
 * a font page is — white glyphs a renderer tints, and nothing around them.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param mask - One alpha byte per pixel, `width * height` long.
 * @returns The bytes of the file.
 * @example
 * ```ts
 * maskPng(1, 1, Uint8Array.from([255])).length; // 70: one opaque white pixel
 * ```
 */
export function maskPng(width: number, height: number, mask: Uint8Array): Uint8Array {
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);

  for (let row = 0; row < height; row += 1) {
    const start = row * stride;

    for (let column = 0; column < width; column += 1) {
      const pixel = start + 1 + column * 4;

      raw[pixel] = 0xff;
      raw[pixel + 1] = 0xff;
      raw[pixel + 2] = 0xff;
      raw[pixel + 3] = mask[row * width + column] ?? 0;
    }
  }

  return pngOf(width, height, TRUECOLOUR_ALPHA, raw);
}
