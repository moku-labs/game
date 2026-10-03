/**
 * @file assets packer, build time — pixels in and WebP out. This is the one file that loads
 * `sharp` (lint rule L11), and it loads it lazily: a game that never packs needs no native
 * binary, and `bun run assets:keys` never touches it.
 */
import type { Sharp, SharpOptions } from "sharp";

/** WebP quality of every page and every encoded loose texture. */
export const WEBP_QUALITY = 80;

/** WebP quality of the alpha plane. */
export const WEBP_ALPHA_QUALITY = 80;

/** Bytes per pixel of the decoded images: RGBA, 8 bits each. */
const CHANNELS = 4;

/** The decoded pixels of one image: RGBA, row after row, no padding. */
export type Pixels = { width: number; height: number; data: Uint8Array };

/** One decoded texture and where its top-left pixel goes on the page. */
export type PagePart = { pixels: Pixels; x: number; y: number };

/**
 * What the packer does with pixels: decode a source, compose a page, encode a loose texture.
 * `loadEncoder` builds it over `sharp`; its version is part of the cache key.
 */
export type Encoder = {
  /** The version of `sharp` that encodes: the cache key carries it. */
  version: string;
  /**
   * Decodes one source image to RGBA pixels.
   *
   * @param bytes - The PNG or WebP file.
   * @returns The pixels.
   */
  decode(bytes: Uint8Array): Promise<Pixels>;
  /**
   * Copies the decoded textures onto a transparent page and encodes it as WebP.
   *
   * @param width - Width of the page.
   * @param height - Height of the page.
   * @param parts - The textures and their places.
   * @returns The WebP bytes of the page.
   */
  page(width: number, height: number, parts: readonly PagePart[]): Promise<Uint8Array>;
  /**
   * Encodes one source image as WebP, for a loose PNG.
   *
   * @param bytes - The PNG file.
   * @returns The WebP bytes.
   */
  webp(bytes: Uint8Array): Promise<Uint8Array>;
};

/** The default export of the `sharp` module: the factory and its version table. */
type SharpFactory = ((input?: Uint8Array, options?: SharpOptions) => Sharp) & {
  versions: { sharp?: string };
};

/**
 * Copies the rows of one decoded texture into the pixels of a page. A copy, not a blend: the
 * page is transparent everywhere else, so the frame holds exactly the source's pixels.
 *
 * @param page - The RGBA pixels of the page.
 * @param pageWidth - Width of the page.
 * @param part - The texture and its place.
 */
function blit(page: Uint8Array, pageWidth: number, part: PagePart): void {
  const { pixels, x, y } = part;
  const rowBytes = pixels.width * CHANNELS;

  for (let row = 0; row < pixels.height; row += 1) {
    const from = row * rowBytes;

    page.set(pixels.data.subarray(from, from + rowBytes), ((y + row) * pageWidth + x) * CHANNELS);
  }
}

/**
 * Builds the encoder over the `sharp` factory.
 *
 * @param sharp - The default export of the `sharp` module.
 * @returns The encoder.
 */
function encoderOf(sharp: SharpFactory): Encoder {
  const webpOptions = { quality: WEBP_QUALITY, alphaQuality: WEBP_ALPHA_QUALITY };

  return {
    version: sharp.versions.sharp ?? "unknown",

    decode: async (bytes: Uint8Array): Promise<Pixels> => {
      // sRGB first, so a grey image decodes to four channels as well.
      const { data, info } = await sharp(bytes)
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return { width: info.width, height: info.height, data: new Uint8Array(data) };
    },

    page: async (
      width: number,
      height: number,
      parts: readonly PagePart[]
    ): Promise<Uint8Array> => {
      const pixels = new Uint8Array(width * height * CHANNELS);

      for (const part of parts) blit(pixels, width, part);

      const encoded = await sharp(pixels, { raw: { width, height, channels: CHANNELS } })
        .webp(webpOptions)
        .toBuffer();

      return new Uint8Array(encoded);
    },

    webp: async (bytes: Uint8Array): Promise<Uint8Array> =>
      new Uint8Array(await sharp(bytes).webp(webpOptions).toBuffer())
  };
}

/**
 * Loads `sharp` and builds the encoder. `sharp` is an optional peer dependency of the engine,
 * so a game installs it for its pack command only.
 *
 * @returns The encoder.
 * @throws {Error} When `sharp` is not installed, with the command that installs it.
 * @example
 * ```ts
 * const encoder = await loadEncoder();
 * encoder.version; // the installed sharp version, such as "0.34.5"
 * ```
 */
export async function loadEncoder(): Promise<Encoder> {
  try {
    const module = (await import("sharp")) as { default: SharpFactory };

    return encoderOf(module.default);
  } catch (error) {
    throw new Error('[game] assets: "--pack" needs sharp.\n  Run "bun add -d sharp".', {
      cause: error
    });
  }
}
