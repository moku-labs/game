/**
 * @file project — the two hashes of the index: the sha1 of a file's bytes, the same value the
 * editor uses as a file version, and the revision over every file of the index.
 */
import { createHash } from "node:crypto";

/**
 * Hashes bytes or text with sha1.
 *
 * @param bytes - The file bytes, or a text.
 * @returns The hex digest.
 * @example
 * ```ts
 * sha1(""); // "da39a3ee5e6b4b0d3255bfef95601890afd80709"
 * ```
 */
export function sha1(bytes: Uint8Array | string): string {
  // eslint-disable-next-line sonarjs/hashing -- the file version the editor compares, not a secret
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * The revision of an index: the sha1 of the lines `${path}\0${hash}\n`, sorted by path.
 *
 * @param files - Every indexed file with its hash.
 * @returns The hex digest.
 * @example
 * ```ts
 * revisionOf({}); // "da39a3ee5e6b4b0d3255bfef95601890afd80709"
 * ```
 */
export function revisionOf(files: Readonly<Record<string, { readonly hash: string }>>): string {
  // A line starts with its path and the path ends at \0, so sorting the lines sorts the paths.
  const lines = Object.entries(files).map(([file, entry]) => `${file}\0${entry.hash}\n`);

  return sha1(lines.toSorted().join(""));
}
