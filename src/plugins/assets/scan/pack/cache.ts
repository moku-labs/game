/**
 * @file assets packer, build time — the content-hash cache. One entry per atlas group and per
 * encoded loose texture, keyed by everything that decides its bytes: the format of the entry, the
 * versions of `sharp` and `maxrects-packer`, the packing constants and the members (key, SHA-256
 * of the source, nine). A hit replays the frames and the encoded bytes: no decode, no encode.
 * Entries are content-addressed, so the cache is never pruned.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { NineSlice } from "../../types";
import { WEBP_ALPHA_QUALITY, WEBP_QUALITY } from "./encode";
import { BORDER, type LayoutFrame, PADDING, PAGE_SIZE } from "./layout";

/** The cache folder under the working directory. */
export const CACHE_FOLDER = path.join("node_modules", ".cache", "moku-game-pack");

/** Changes when the shape of an entry changes, so an old entry is never read as a new one. */
const FORMAT = "pack-1";

/** One member of a cache entry: a texture by its key, the hash of its source and its borders. */
export type CacheMember = { key: string; source: string; nine: NineSlice | undefined };

/** What one cache key is computed from. */
export type CacheKeyInput = {
  /** `atlas` for the pages of a group, `loose` for one encoded loose texture. */
  kind: "atlas" | "loose";
  /** The version of `sharp` that encodes. */
  sharp: string;
  /** The members, in any order. */
  members: readonly CacheMember[];
};

/** One encoded image of an entry: a page with its frames, or a loose texture with none. */
export type CachedImage = {
  width: number;
  height: number;
  frames: readonly LayoutFrame[];
  bytes: Uint8Array;
};

/** The JSON file of an entry: every image without its bytes. */
type EntryFile = { images: Array<Omit<CachedImage, "bytes">> };

/**
 * Hashes bytes into the hex SHA-256 the cache keys and members use.
 *
 * @param bytes - Anything.
 * @returns 64 lowercase hex characters.
 * @example
 * ```ts
 * sha256(new TextEncoder().encode("abc")).slice(0, 10); // "ba7816bf8f"
 * ```
 */
export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Reads the version of `maxrects-packer` that is installed: its layout decides the frames, so a
 * new version is a new cache.
 *
 * @returns The version from its `package.json`.
 */
function packerVersion(): string {
  const manifest = createRequire(import.meta.url)("maxrects-packer/package.json") as {
    version?: unknown;
  };

  return typeof manifest.version === "string" ? manifest.version : "unknown";
}

/**
 * Computes the cache key of one entry from everything that decides its bytes.
 *
 * @param input - The kind, the encoder version and the members.
 * @returns The key: 64 hex characters, also the file name of the entry.
 * @example
 * ```ts
 * cacheKey({ kind: "loose", sharp: "0.34.5", members: [] }).length; // 64, the same key on every run
 * ```
 */
export function cacheKey(input: CacheKeyInput): string {
  const members = input.members
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map(member => [
      member.key,
      member.source,
      member.nine === undefined
        ? undefined
        : [member.nine.left, member.nine.top, member.nine.right, member.nine.bottom]
    ]);

  return sha256(
    JSON.stringify({
      format: FORMAT,
      kind: input.kind,
      sharp: input.sharp,
      packer: packerVersion(),
      page: PAGE_SIZE,
      border: BORDER,
      padding: PADDING,
      quality: WEBP_QUALITY,
      alphaQuality: WEBP_ALPHA_QUALITY,
      members
    })
  );
}

/**
 * Tells whether a value read from an entry file is one frame.
 *
 * @param value - Anything the JSON carried.
 * @returns True for a frame.
 */
function isFrame(value: unknown): value is LayoutFrame {
  if (typeof value !== "object" || value === null) return false;

  const frame = value as Record<string, unknown>;

  return (
    typeof frame.key === "string" &&
    ["x", "y", "width", "height"].every(field => typeof frame[field] === "number")
  );
}

/**
 * Reads the JSON file of an entry. A file that is missing, broken or of another shape is a miss.
 *
 * @param file - Path of the JSON file.
 * @returns The images without their bytes, or `undefined`.
 */
async function readEntryFile(file: string): Promise<EntryFile["images"] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { images?: unknown };

    if (!Array.isArray(parsed.images)) return undefined;

    const images = parsed.images as Array<Record<string, unknown>>;
    const valid = images.every(
      image =>
        typeof image.width === "number" &&
        typeof image.height === "number" &&
        Array.isArray(image.frames) &&
        image.frames.every(frame => isFrame(frame))
    );

    return valid ? (images as EntryFile["images"]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads one entry of the cache.
 *
 * @param folder - The cache folder, or `false` when the cache is off.
 * @param key - The cache key of the entry.
 * @returns The images with their bytes, or `undefined` on a miss.
 */
export async function readCache(
  folder: string | false,
  key: string
): Promise<CachedImage[] | undefined> {
  if (folder === false) return undefined;

  const images = await readEntryFile(path.join(folder, `${key}.json`));

  if (images === undefined) return undefined;

  try {
    return await Promise.all(
      images.map(async (image, index) => ({
        ...image,
        bytes: new Uint8Array(await readFile(path.join(folder, `${key}-${index}.webp`)))
      }))
    );
  } catch {
    return undefined;
  }
}

/**
 * Writes one entry of the cache: the bytes of every image first, the JSON file last, so a run
 * that stops half way leaves a miss, never a broken hit.
 *
 * @param folder - The cache folder, or `false` when the cache is off.
 * @param key - The cache key of the entry.
 * @param images - The encoded images and their frames.
 */
export async function writeCache(
  folder: string | false,
  key: string,
  images: readonly CachedImage[]
): Promise<void> {
  if (folder === false) return;

  await mkdir(folder, { recursive: true });

  for (const [index, image] of images.entries()) {
    await writeFile(path.join(folder, `${key}-${index}.webp`), image.bytes);
  }

  const entry: EntryFile = {
    images: images.map(({ width, height, frames }) => ({ width, height, frames }))
  };

  await writeFile(path.join(folder, `${key}.json`), JSON.stringify(entry));
}
