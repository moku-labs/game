/**
 * @file assets plugin, build time — the size of an image from its first bytes. No decode and no
 * image library: 30 bytes carry the width and the height of a PNG and of the three WebP flavours,
 * which is all the manifest needs to estimate texture memory.
 */

/** How many bytes of a file the scanner reads. The `VP8X` canvas size ends at byte 29. */
export const HEADER_BYTES = 30;

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const VP8_SYNC: readonly number[] = [0x9d, 0x01, 0x2a];

const VP8L_SIGNATURE = 0x2f;

/** Both WebP frame headers carry the width and the height in 14 bits each. */
const SIZE_MASK = 0x3f_ff;

const BYTES_PER_PIXEL = 4;

const BYTES_PER_MB = 1_048_576;

/**
 * The pixel size of one image.
 */
export type ImageSize = {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
};

/**
 * Wraps a scanner problem in the message shape of the framework.
 *
 * @param message - One sentence naming the file.
 * @returns The error to throw.
 */
function problem(message: string): Error {
  return new Error(`[game] assets: ${message}`);
}

/**
 * Reads the bytes as a data view.
 *
 * @param head - The first bytes of the file.
 * @returns A view over exactly those bytes.
 */
function viewOf(head: Uint8Array): DataView {
  return new DataView(head.buffer, head.byteOffset, head.byteLength);
}

/**
 * Tells whether a run of bytes stands at an offset.
 *
 * @param head - The first bytes of the file.
 * @param offset - Where to look.
 * @param bytes - What to find.
 * @returns True when every byte matches.
 */
function hasBytes(head: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/**
 * Reads a run of bytes as ASCII, which is what the chunk names of these formats are.
 *
 * @param head - The first bytes of the file.
 * @param offset - Where to start.
 * @param length - How many bytes to read.
 * @returns The text.
 */
function ascii(head: Uint8Array, offset: number, length: number): string {
  return String.fromCodePoint(...head.subarray(offset, offset + length));
}

/**
 * Reads a 24-bit little-endian number, the shape the `VP8X` canvas size uses.
 *
 * @param view - A view over the header bytes.
 * @param offset - Where the number starts.
 * @returns The number.
 */
function uint24Le(view: DataView, offset: number): number {
  return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}

/**
 * Reads the size out of the IHDR chunk of a PNG.
 *
 * @param head - The first bytes of the file.
 * @returns The size.
 */
function readPng(head: Uint8Array): ImageSize {
  const view = viewOf(head);

  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Reads the size out of the frame header of a WebP, whichever of the three chunks it carries.
 *
 * @param head - The first bytes of the file.
 * @param file - Path of the file, for the messages.
 * @returns The size.
 * @throws {Error} When the chunk is unknown or its frame header is damaged.
 */
function readWebp(head: Uint8Array, file: string): ImageSize {
  const view = viewOf(head);
  const chunk = ascii(head, 12, 4);

  if (chunk === "VP8 ") {
    if (!hasBytes(head, 23, VP8_SYNC)) throw problem(`the VP8 frame of "${file}" is damaged.`);

    return {
      width: view.getUint16(26, true) & SIZE_MASK,
      height: view.getUint16(28, true) & SIZE_MASK
    };
  }

  if (chunk === "VP8L") {
    if (head[20] !== VP8L_SIGNATURE) throw problem(`the VP8L frame of "${file}" is damaged.`);

    const bits = view.getUint32(21, true);

    return { width: (bits & SIZE_MASK) + 1, height: ((bits >>> 14) & SIZE_MASK) + 1 };
  }

  if (chunk === "VP8X") {
    return { width: uint24Le(view, 24) + 1, height: uint24Le(view, 27) + 1 };
  }

  throw problem(`"${file}" carries the WebP chunk "${chunk}", which this version cannot read.`);
}

/**
 * Reads the pixel size of an image out of its header bytes.
 *
 * @param head - The first `HEADER_BYTES` bytes of the file.
 * @param file - Path of the file, for the messages.
 * @returns The size.
 * @throws {Error} When the bytes are neither a PNG nor a WebP the scanner reads.
 * @example
 * ```ts
 * readImageSize(await readHead("panel.png"), "features/ui/assets/panel.png");
 * // { width: 256, height: 128 }
 * ```
 */
export function readImageSize(head: Uint8Array, file: string): ImageSize {
  if (head.length >= HEADER_BYTES) {
    if (hasBytes(head, 0, PNG_SIGNATURE) && ascii(head, 12, 4) === "IHDR") return readPng(head);
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return readWebp(head, file);
  }

  throw problem(`"${file}" is not a PNG or a WebP file.`);
}

/**
 * Estimates what one image costs on the GPU: four bytes per pixel, no mipmaps, rounded to three
 * decimals so two scans of the same tree write the same bytes.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns The estimated texture memory in MB.
 * @example
 * ```ts
 * textureMb(256, 128); // 0.125
 * ```
 */
export function textureMb(width: number, height: number): number {
  return Math.round(((width * height * BYTES_PER_PIXEL) / BYTES_PER_MB) * 1000) / 1000;
}

/**
 * What a file costs in memory when it is kept as it is: an audio file is held undecoded, so its
 * bytes are the estimate. Rounded to three decimals, like every other number of the manifest.
 *
 * @param bytes - Size of the file in bytes.
 * @returns The size in MB.
 * @example
 * ```ts
 * bytesMb(8192); // 0.008
 * ```
 */
export function bytesMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 1000) / 1000;
}
