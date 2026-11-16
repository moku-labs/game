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

/**
 * Pixels each frame's edge is copied out into its padding (F105): bilinear sampling at a fractional place reads half a
 * texel past the frame, which must be the frame's own edge, never the page's clear padding. One pixel each side keeps
 * two neighbours `PADDING` apart from writing over each other.
 */
export const EXTRUDE = 1;

/**
 * Where a frame lies inside its original image, when the original was trimmed (F198). All four
 * fields go together; a frame without them is the whole image.
 */
export type Trim = { offsetX: number; offsetY: number; origWidth: number; origHeight: number };

/** Where one texture lies on its page, in page pixels, and where it lay in its original if trimmed. */
export type LayoutFrame = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
  origWidth?: number;
  origHeight?: number;
};

/** One page of an atlas group: its size and its frames, sorted by key. */
export type LayoutPage = { width: number; height: number; frames: readonly LayoutFrame[] };

/**
 * A member of a layout: its key and the size of what goes on the page (the cut, when it was
 * trimmed). `trim` says where the cut lay in the original, whose size a loose file keeps.
 */
export type Boxed = Sized & { trim?: Trim };

/**
 * The pages of one group, the members that stay loose and one sentence per texture or rule the
 * packing broke.
 */
export type Layout = {
  pages: readonly LayoutPage[];
  loose: readonly Boxed[];
  problems: readonly string[];
};

/** A rectangle of the packer that carries the key of its texture and its trim. */
type KeyedRect = Rectangle & { data: { key: string; trim: Trim | undefined } };

/**
 * The size `maxrects-packer` is given (F188). It lets a bin grow to its size plus the padding, so a
 * packer of `PAGE_SIZE` wrote 2050 px pages; one of `PAGE_SIZE - PADDING` never passes `PAGE_SIZE`.
 */
export const PACKER_SIZE = PAGE_SIZE - PADDING;

/** The largest side of a frame a page holds, inside its border: 2042 px. */
const ROOM = PACKER_SIZE - BORDER * 2;

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
 * Compares two members by key.
 *
 * @param left - One member.
 * @param right - Another member.
 * @returns The sort order.
 */
function byKey(left: Sized, right: Sized): number {
  return left.key.localeCompare(right.key);
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
      height: rect.height,
      ...rect.data.trim
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

/**
 * Names every texture that fits no page, one sentence each, sorted by key.
 *
 * @param members - The textures that do not fit.
 * @returns One problem per texture that is too large.
 * @example
 * ```ts
 * unfitProblems([{ key: "ui.sky", width: 4096, height: 64 }]); // ['the texture "ui.sky" (4096×64) fits no 2048×2048 page with its 2 px border and 2 px padding.']
 * ```
 */
function unfitProblems(members: readonly Sized[]): string[] {
  return members
    .toSorted(byKey)
    .map(
      member =>
        `the texture "${member.key}" (${member.width}×${member.height}) fits no ` +
        `${PAGE_SIZE}×${PAGE_SIZE} page with its ${BORDER} px border and ${PADDING} px padding.`
    );
}

/**
 * Lays the members of one atlas group out on pages of at most 2048 × 2048 pixels: 2 px of
 * padding between frames and a 2 px border, never rotated, so every frame keeps the size of its cut
 * and a nine-slice (never trimmed) keeps its borders. A member that fits no page goes back in
 * `loose` when the group is `main`; in `fx` it is a problem naming its key, never a silent drop or
 * a loose file, because production does not filter to one source and a loose `fx` texture would
 * sample the wrong page in silence. A `main` layout that packs fewer than two members leaves them
 * all loose: a page of one costs its padding and gains nothing. An `fx` group that needs more than
 * one page is a problem naming the bundle and the count, because a particle emitter binds one page.
 *
 * @param bundle - Name of the bundle, for the messages.
 * @param group - The atlas group.
 * @param members - Its textures, with the sizes that go on the page.
 * @returns The pages, the members left loose and the problems.
 * @example
 * ```ts
 * layoutGroup("ui", "main", [{ key: "ui.dot", width: 8, height: 8 }, { key: "ui.sky", width: 4096, height: 64 }]).loose; // [{ key: "ui.dot", width: 8, height: 8 }, { key: "ui.sky", width: 4096, height: 64 }]
 * ```
 */
export function layoutGroup(bundle: string, group: Group, members: readonly Boxed[]): Layout {
  const fits = members.filter(entry => entry.width <= ROOM && entry.height <= ROOM);
  const unfit = members.filter(entry => entry.width > ROOM || entry.height > ROOM);
  const problems = group === "fx" ? unfitProblems(unfit) : [];

  // The rest goes to the packer in a fixed order, so the same members give the same layout.
  const packer = new MaxRectsPacker<KeyedRect>(PACKER_SIZE, PACKER_SIZE, PADDING, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    border: BORDER
  });

  for (const member of fits.toSorted(packingOrder)) {
    packer.add(member.width, member.height, { key: member.key, trim: member.trim });
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

  // A page of one member costs its padding and gains nothing: a main group of one stays loose.
  if (group === "main" && fits.length < 2) {
    return { pages: [], loose: members.toSorted(byKey), problems };
  }

  return { pages, loose: group === "main" ? unfit.toSorted(byKey) : [], problems };
}
