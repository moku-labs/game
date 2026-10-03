/**
 * @file assets packer, build time — the content hash and the file name rules of the pack folder.
 * Pure: a name is built from a bundle, a key and the hash of the bytes it holds, and is never
 * parsed back. The manifest is the only reader of the folder.
 */
import { createHash } from "node:crypto";
import type { Group } from "./groups";

/** How many hex characters of the SHA-256 a file name carries. */
const HASH_LENGTH = 10;

/**
 * Hashes the bytes of one output file: the first 10 hex characters of their SHA-256. A file that
 * changes gets a new name, so a CDN may cache every name forever.
 *
 * @param bytes - The bytes as they are written.
 * @returns Ten lowercase hex characters.
 * @example
 * ```ts
 * contentHash(new TextEncoder().encode("abc")); // "ba7816bf8f"
 * ```
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Names an atlas page in the manifest: the id an `atlas` frame points at.
 *
 * @param bundle - Name of the bundle.
 * @param group - The atlas group of the page.
 * @param index - Its index inside the group, from 0.
 * @returns The page id.
 * @example
 * ```ts
 * pageId("ui", "main", 0); // "ui/main-0"
 * ```
 */
export function pageId(bundle: string, group: Group, index: number): string {
  return `${bundle}/${group}-${index}`;
}

/**
 * Names the file of an atlas page.
 *
 * @param bundle - Name of the bundle.
 * @param group - The atlas group of the page.
 * @param index - Its index inside the group, from 0.
 * @param hash - The content hash of the WebP bytes.
 * @returns The path inside the pack folder.
 * @example
 * ```ts
 * pageName("ui", "fx", 0, "2a7f9c04e1"); // "ui/fx-0-2a7f9c04e1.webp"
 * ```
 */
export function pageName(bundle: string, group: Group, index: number, hash: string): string {
  return `${pageId(bundle, group, index)}-${hash}.webp`;
}

/**
 * Names the file of a loose texture.
 *
 * @param bundle - Name of the bundle.
 * @param key - Asset key of the texture.
 * @param hash - The content hash of the bytes.
 * @param extension - The extension of the written format, without the dot.
 * @returns The path inside the pack folder.
 * @example
 * ```ts
 * looseName("ui", "ui.bg-splash", "5e0a71bd42", "webp"); // "ui/ui.bg-splash-5e0a71bd42.webp"
 * ```
 */
export function looseName(bundle: string, key: string, hash: string, extension: string): string {
  return `${bundle}/${key}-${hash}.${extension}`;
}

/**
 * Names the `.fnt` file of a font.
 *
 * @param bundle - Name of the bundle.
 * @param key - Asset key of the font.
 * @param hash - The content hash of the rewritten `.fnt` bytes.
 * @returns The path inside the pack folder.
 * @example
 * ```ts
 * fontName("ui", "ui.font-body", "7d2c90f1ab"); // "ui/ui.font-body-7d2c90f1ab.fnt"
 * ```
 */
export function fontName(bundle: string, key: string, hash: string): string {
  return `${bundle}/${key}-${hash}.fnt`;
}

/**
 * Names one page image of a font. The page keeps its format: MSDF needs lossless pixels.
 *
 * @param bundle - Name of the bundle.
 * @param key - Asset key of the font.
 * @param index - The index of the page, in the order the font declares them.
 * @param hash - The content hash of the page bytes.
 * @param extension - The extension of the source page, without the dot.
 * @returns The path inside the pack folder.
 * @example
 * ```ts
 * fontPageName("ui", "ui.font-body", 0, "c81f3e2d55", "png"); // "ui/ui.font-body-0-c81f3e2d55.png"
 * ```
 */
export function fontPageName(
  bundle: string,
  key: string,
  index: number,
  hash: string,
  extension: string
): string {
  return `${bundle}/${key}-${index}-${hash}.${extension}`;
}

/**
 * Names the file of a sound.
 *
 * @param bundle - Name of the bundle.
 * @param key - Asset key of the sound.
 * @param hash - The content hash of the bytes.
 * @returns The path inside the pack folder.
 * @example
 * ```ts
 * audioName("ui", "ui.click", "9c4e2b7a10"); // "ui/ui.click-9c4e2b7a10.mp3"
 * ```
 */
export function audioName(bundle: string, key: string, hash: string): string {
  return `${bundle}/${key}-${hash}.mp3`;
}
