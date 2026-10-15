/**
 * @file project — the two hashes of the index: the sha1 of a file's bytes, the same value the
 * editor uses as a file version, and the revision over every file of the index.
 */
import { createHash } from "node:crypto";
import type { FeatureOwner } from "./features";

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
 * The revision of an index: the sha1 of the lines `${path}\0${hash}\n`, one per file, and
 * `${dir}/\0${parent}\n`, one per feature unit, all sorted together. Without units the value is
 * the one of the files alone.
 *
 * @param files - Every indexed file with its hash.
 * @param owners - The feature units of the game: owners and code-only sub-features.
 * @returns The hex digest.
 * @example
 * ```ts
 * revisionOf({}); // "da39a3ee5e6b4b0d3255bfef95601890afd80709"
 * ```
 */
export function revisionOf(
  files: Readonly<Record<string, { readonly hash: string }>>,
  owners: readonly Pick<FeatureOwner, "dir" | "parent">[] = []
): string {
  // A line starts with its path and the path ends at \0, so sorting the lines sorts the paths. A
  // unit's folder ends with `/`, so its line never equals a file's.
  const lines = Object.entries(files).map(([file, entry]) => `${file}\0${entry.hash}\n`);
  const units = owners.map(owner => `${owner.dir}/\0${owner.parent ?? ""}\n`);

  return sha1([...lines, ...units].toSorted().join(""));
}
