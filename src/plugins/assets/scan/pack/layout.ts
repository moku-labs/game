/**
 * @file assets packer, build time — where each texture of an atlas group lies on its pages. Pure
 * over sizes: `maxrects-packer` places rectangles, nothing here reads a pixel. This is the one
 * file that imports `maxrects-packer` (lint rule L11); its version decides the layout, so the
 * package is pinned and the cache key carries it.
 */
import { MaxRectsBin, MaxRectsPacker, type Rectangle } from "maxrects-packer";
import type { Group, Sized } from "./groups";

/** The largest page, in pixels per side. A page is only as large as its content. */
export const PAGE_SIZE = 2048;

/** Transparent pixels between two frames. */
export const PADDING = 2;

/** Transparent pixels between a frame and the edge of its page. */
export const BORDER = 2;

/** Where one texture lies on its page, in page pixels. */
export type LayoutFrame = { key: string; x: number; y: number; width: number; height: number };

/** One page of an atlas group: its size and its frames, sorted by key. */
export type LayoutPage = { width: number; height: number; frames: readonly LayoutFrame[] };

/** The pages of one group, and one sentence per texture or rule the packing broke. */
export type Layout = { pages: readonly LayoutPage[]; problems: readonly string[] };

/** A rectangle of the packer that carries the key of its texture. */
type KeyedRect = Rectangle & { data: { key: string } };

/**
 * Compares two members the way the packer likes them: the longest side first, a larger area
 * next, the key last, so the same members give the same layout in any input order.
 *
 * @param left - One member.
 * @param right - Another member.
 * @returns The sort order.
 */
function packingOrder(left: Sized, right: Sized): number {
  return (
    Math.max(right.width, right.height) - Math.max(left.width, left.height) ||
    right.width * right.height - left.width * left.height ||
    left.key.localeCompare(right.key)
  );
}

/**
 * Tells whether a texture fits a page at all, inside the border.
 *
 * @param member - The texture.
 * @returns True when both sides fit.
 * @example
 * ```ts
 * fitsPage({ key: "ui.fx-rays", width: 504, height: 512 }); // true
 * ```
 */
function fitsPage(member: Sized): boolean {
  const room = PAGE_SIZE - BORDER * 2;

  return member.width <= room && member.height <= room;
}

/**
 * Reads the frames of one bin of the packer, sorted by key.
 *
 * @param rects - The rectangles the packer placed on the bin.
 * @returns The frames.
 */
function framesOf(rects: readonly KeyedRect[]): LayoutFrame[] {
  return rects
    .map(rect => ({
      key: rect.data.key,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

/**
 * Names every texture that fits no page, one sentence each, sorted by key.
 *
 * @param members - The textures of a group.
 * @returns One problem per texture that is too large.
 * @example
 * ```ts
 * unfitProblems([{ key: "ui.sky", width: 4096, height: 64 }]); // ['the texture "ui.sky" (4096×64) fits no 2048×2048 page with a 2 px border.']
 * ```
 */
function unfitProblems(members: readonly Sized[]): string[] {
  return members
    .filter(member => !fitsPage(member))
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map(
      member =>
        `the texture "${member.key}" (${member.width}×${member.height}) fits no ` +
        `${PAGE_SIZE}×${PAGE_SIZE} page with a ${BORDER} px border.`
    );
}

/**
 * Lays the members of one atlas group out on pages of at most 2048 × 2048 pixels: 2 px of
 * padding between frames and a 2 px border, never trimmed and never rotated, so every frame keeps
 * the size of its source and a nine-slice keeps its borders. A texture that fits no page is a
 * problem naming its key, never a silent drop; an `fx` group that needs more than one page is a
 * problem naming the bundle and the count, because a particle emitter binds one page.
 *
 * @param bundle - Name of the bundle, for the messages.
 * @param group - The atlas group.
 * @param members - Its textures, with their sizes.
 * @returns The pages and the problems.
 * @example
 * ```ts
 * layoutGroup("ui", "main", [{ key: "ui.dot", width: 8, height: 8 }]).pages; // [{ width: 12, height: 12, frames: [{ key: "ui.dot", x: 2, y: 2, width: 8, height: 8 }] }]
 * ```
 */
export function layoutGroup(bundle: string, group: Group, members: readonly Sized[]): Layout {
  // A texture larger than a page is reported by key and left out of the packing.
  const problems = unfitProblems(members);

  // The rest goes to the packer in a fixed order, so the same members give the same layout.
  const packer = new MaxRectsPacker<KeyedRect>(PAGE_SIZE, PAGE_SIZE, PADDING, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    border: BORDER
  });

  for (const member of members.filter(entry => fitsPage(entry)).toSorted(packingOrder)) {
    packer.add(member.width, member.height, { key: member.key });
  }

  // Every bin that holds a frame becomes a page.
  const pages = packer.bins
    .filter(bin => bin instanceof MaxRectsBin && bin.rects.length > 0)
    .map(bin => ({ width: bin.width, height: bin.height, frames: framesOf(bin.rects) }));

  // A particle emitter binds one page, so an fx group must fit on one.
  if (group === "fx" && pages.length > 1) {
    problems.push(
      `the fx textures of bundle "${bundle}" need ${pages.length} pages; a particle emitter ` +
        "binds one. Make them smaller, or move some to another bundle."
    );
  }

  return { pages, problems };
}
