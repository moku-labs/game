/**
 * @file assets packer, build time — the notes of a pack: a texture file kept under two or more
 * keys is named once, with its keys and its bundles. A note never fails the pack.
 */
import { textureMb } from "../image-size";

/** A texture as a note names it: its key, its bundle and the size of its header. */
type Twin = { key: string; bundle: string; width: number; height: number };

/** SHA-256 of a texture source to every texture read with those bytes, in reading order. */
export type Twins = Map<string, Twin[]>;

/**
 * Remembers a texture under the hash of its source bytes.
 *
 * @param twins - The textures read so far, by hash.
 * @param bundle - Name of the bundle the texture belongs to.
 * @param source - The texture: its key, the hash of its bytes and the size of its header.
 * @param source.key - Its key.
 * @param source.sha - SHA-256 of its source bytes.
 * @param source.width - Width of its header.
 * @param source.height - Height of its header.
 */
export function recordTwin(
  twins: Twins,
  bundle: string,
  source: { key: string; sha: string; width: number; height: number }
): void {
  const { key, sha, width, height } = source;

  twins.set(sha, [...(twins.get(sha) ?? []), { key, bundle, width, height }]);
}

/**
 * Writes the sentence of one file kept under several keys.
 *
 * @param first - The texture with the first key of the group.
 * @param group - Every texture of the group, sorted by key.
 * @returns The line.
 */
function twinLine(first: Twin, group: readonly Twin[]): string {
  const keys = group.map(entry => `"${entry.key}"`).join(", ");
  const bundles = [...new Set(group.map(entry => entry.bundle))].map(name => `"${name}"`);
  const noun = bundles.length === 1 ? "bundle" : "bundles";
  const mb = textureMb(first.width, first.height);

  return (
    `the same file (${first.width}×${first.height}, ${mb} MB) is kept under ${group.length} keys: ` +
    `${keys}, in ${noun} ${bundles.join(", ")}.`
  );
}

/**
 * Writes one line per group of textures that were read with the same bytes under different keys.
 *
 * @param twins - SHA-256 of a source to the textures read with those bytes.
 * @returns The lines, sorted by the first key of each group.
 * @example
 * ```ts
 * twinNotes(new Map([["9f2c", [{ key: "ui.x", bundle: "ui", width: 64, height: 32 }, { key: "shop.x", bundle: "shop", width: 64, height: 32 }]]]));
 * // ['the same file (64×32, 0.008 MB) is kept under 2 keys: "shop.x", "ui.x", in bundles "shop", "ui".']
 * ```
 */
export function twinNotes(twins: Twins): string[] {
  const lines: { key: string; line: string }[] = [];

  // Keep the groups of two or more, each in key order.
  for (const entries of twins.values()) {
    const group = entries.toSorted((left, right) => left.key.localeCompare(right.key));
    const [first] = group;

    if (first === undefined || group.length < 2) continue;

    lines.push({ key: first.key, line: twinLine(first, group) });
  }

  // One sentence per group, in the order of their first keys.
  return lines
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map(entry => entry.line);
}
