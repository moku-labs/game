/**
 * @file assets packer, build time — the cuts of one atlas group that hold the same pixels are laid
 * out once: `splitRepeats` tells the first cut of each picture from its repeats, and `withRepeats`
 * gives every repeat a frame on the rectangle of the cut it repeats.
 */
import { sha256 } from "./cache";
import type { Pixels } from "./encode";
import type { LayoutPage, Trim } from "./layout";

/** What the two functions read of a cut: its key, the pixels that go on the page and its trim. */
type Cut = { source: { key: string }; pixels: Pixels; trim?: Trim };

/**
 * Tells the cuts that go to the layout from the ones that repeat the pixels of an earlier cut. A
 * repeat is laid out with the cut it repeats: its key gets the same rectangle of the page.
 *
 * @param cuts - The cuts of a group, in key order.
 * @returns The cuts to lay out, and each repeat under the key of the cut it repeats.
 */
export function splitRepeats<Member extends Cut>(
  cuts: readonly Member[]
): { first: Member[]; repeats: Map<string, Member[]> } {
  const seen = new Map<string, Member>();
  const first: Member[] = [];
  const repeats = new Map<string, Member[]>();

  for (const cut of cuts) {
    const print = `${cut.pixels.width}x${cut.pixels.height}:${sha256(cut.pixels.data)}`;
    const earlier = seen.get(print);

    if (earlier === undefined) {
      seen.set(print, cut);
      first.push(cut);
      continue;
    }

    repeats.set(earlier.source.key, [...(repeats.get(earlier.source.key) ?? []), cut]);
  }

  return { first, repeats };
}

/**
 * Gives every repeat a frame on the rectangle of the cut it repeats, with the repeat's own trim.
 *
 * @param page - A page of the layout, with one frame per laid-out cut.
 * @param repeats - The repeats, under the key of the cut each one repeats.
 * @returns The page with the frames of the repeats added, sorted by key.
 */
export function withRepeats(
  page: LayoutPage,
  repeats: ReadonlyMap<string, readonly Cut[]>
): LayoutPage {
  const frames = page.frames.flatMap(frame => [
    frame,
    ...(repeats.get(frame.key) ?? []).map(cut => ({
      key: cut.source.key,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      ...cut.trim
    }))
  ]);

  return { ...page, frames: frames.toSorted((left, right) => left.key.localeCompare(right.key)) };
}
