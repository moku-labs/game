/**
 * @file assets packer, build time — where each texture of an atlas group lies on its pages. Pure
 * over sizes: `maxrects-packer` places rectangles, nothing here reads a pixel. This is the one
 * file that imports `maxrects-packer` (lint rule L11); its version decides the layout, so the
 * package is pinned and the cache key carries it.
 */
import { MaxRectsBin, MaxRectsPacker, type Rectangle } from "maxrects-packer";
import type { Group, Sized } from "./groups";
import { glMb, pixelMb } from "./price";

/**
 * The page sizes a group is laid out at, in pixels per side, smallest first (F198). `chooseLayout`
 * lays the group out once per size and keeps the layout the phone pays least GL memory for. A page
 * is only as large as its content.
 *
 * Build H (hybrid): `[1024, 2048, 4096]` with `LOOSE_SIDE = 4090` in `groups.ts`. Build F (fixed):
 * `[2048]` with `LOOSE_SIDE = 1018`. The two constants change together; a one-line change in each
 * file makes the other build for the phone A/B.
 */
export const PAGE_SIZES: readonly number[] = [1024, 2048, 4096];

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

/** Two layouts whose prices lie this close (GL MiB) are a tie: the one with fewer textures wins. */
const TIE_MIB = 0.5;

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

/** One layout of a group at one page size, with what the choice compares. */
type Candidate = { page: number; layout: Layout; price: number; textures: number };

/**
 * Gives the size the `maxrects-packer` is given for a page size (F188). It lets a bin grow to its
 * size plus the padding, so a packer of `page` wrote pages of `page + PADDING`; one of
 * `page - PADDING` never passes `page`.
 *
 * @param page - The page size.
 * @returns The packer size.
 * @example
 * ```ts
 * packerSizeOf(2048); // 2046
 * ```
 */
export function packerSizeOf(page: number): number {
  return page - PADDING;
}

/**
 * Gives the largest side of a frame a page holds, inside its border.
 *
 * @param page - The page size.
 * @returns The room: 1018 for 1024, 2042 for 2048, 4090 for 4096.
 * @example
 * ```ts
 * roomOf(2048); // 2042
 * ```
 */
export function roomOf(page: number): number {
  return packerSizeOf(page) - BORDER * 2;
}

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
 * Names every texture that fits no page of one size, one sentence each, sorted by key. Only an `fx`
 * texture is a problem: a `main` one stays loose.
 *
 * @param members - The textures that do not fit.
 * @param page - The page size.
 * @returns One problem per texture that is too large.
 * @example
 * ```ts
 * unfitProblems([{ key: "ui.sky", width: 4096, height: 64 }], 2048); // ['the texture "ui.sky" (4096×64) fits no 2048×2048 page with its 2 px border and 2 px padding.']
 * ```
 */
function unfitProblems(members: readonly Sized[], page: number): string[] {
  return members
    .toSorted(byKey)
    .map(
      member =>
        `the texture "${member.key}" (${member.width}×${member.height}) fits no ` +
        `${page}×${page} page with its ${BORDER} px border and ${PADDING} px padding.`
    );
}

/**
 * Lays the members of one atlas group out on pages of at most `page` × `page` pixels: 2 px of
 * padding between frames and a 2 px border, never rotated, so every frame keeps the size of its cut
 * and a nine-slice (never trimmed) keeps its borders. A member that fits no page of that size goes
 * back in `loose` when the group is `main`; in `fx` it is a problem naming its key, never a silent
 * drop or a loose file, because production does not filter to one source and a loose `fx` texture
 * would sample the wrong page in silence. An `fx` group that needs more than one page is a problem
 * naming the bundle and the count, because a particle emitter binds one page.
 *
 * @param bundle - Name of the bundle, for the messages.
 * @param group - The atlas group.
 * @param members - Its textures, with the sizes that go on the page.
 * @param page - The page size, in pixels per side.
 * @returns The pages, the members left loose and the problems.
 * @example
 * ```ts
 * layoutGroup("ui", "main", [{ key: "ui.dot", width: 8, height: 8 }], 1024).pages; // [{ width: 12, height: 12, frames: [{ key: "ui.dot", x: 2, y: 2, width: 8, height: 8 }] }]
 * ```
 */
export function layoutGroup(
  bundle: string,
  group: Group,
  members: readonly Boxed[],
  page: number
): Layout {
  const room = roomOf(page);
  const holds = (entry: Boxed): boolean => entry.width <= room && entry.height <= room;
  const fits = members.filter(entry => holds(entry));
  const unfit = members.filter(entry => !holds(entry));
  const problems = group === "fx" ? unfitProblems(unfit, page) : [];

  // The rest goes to the packer in a fixed order, so the same members give the same layout.
  const packer = new MaxRectsPacker<KeyedRect>(packerSizeOf(page), packerSizeOf(page), PADDING, {
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

  return { pages, loose: group === "main" ? unfit.toSorted(byKey) : [], problems };
}

/**
 * Prices a layout: the GL MiB of its pages and of the members it leaves loose, a loose file read at
 * the size of its original, because a loose file is not trimmed.
 *
 * @param layout - The layout.
 * @returns The price in GL MiB.
 */
function priceOf(layout: Layout): number {
  let price = 0;

  for (const page of layout.pages) price += glMb(pixelMb(page.width, page.height));

  for (const member of layout.loose) {
    const width = member.trim?.origWidth ?? member.width;
    const height = member.trim?.origHeight ?? member.height;

    price += glMb(pixelMb(width, height));
  }

  return price;
}

/**
 * Lays a group out at one page size and prices it. A `main` layout that packs fewer than two
 * members leaves them all loose: a page of one costs its padding and gains nothing.
 *
 * @param bundle - Name of the bundle.
 * @param group - The atlas group.
 * @param members - Its textures.
 * @param page - The page size.
 * @returns The layout with its price and its texture count.
 */
function candidateOf(
  bundle: string,
  group: Group,
  members: readonly Boxed[],
  page: number
): Candidate {
  const laid = layoutGroup(bundle, group, members, page);
  const packed = laid.pages.reduce((count, entry) => count + entry.frames.length, 0);
  const layout: Layout =
    group === "main" && packed < 2
      ? { pages: [], loose: members.toSorted(byKey), problems: [] }
      : laid;

  return {
    page,
    layout,
    price: priceOf(layout),
    textures: layout.pages.length + layout.loose.length
  };
}

/**
 * Tells whether one candidate beats another among the layouts of a tie: fewer textures first, then
 * the lower price, then the smaller page.
 *
 * @param candidate - The candidate.
 * @param best - The best so far.
 * @returns True when the candidate is better.
 */
function beats(candidate: Candidate, best: Candidate): boolean {
  return (
    (candidate.textures - best.textures ||
      candidate.price - best.price ||
      candidate.page - best.page) < 0
  );
}

/**
 * Picks the best of some candidates by a rule, the first of them when none beats it.
 *
 * @param candidates - The candidates.
 * @param better - Tells whether the first candidate beats the second.
 * @returns The best candidate, or `undefined` when there is none.
 */
function bestOf(
  candidates: readonly Candidate[],
  better: (candidate: Candidate, best: Candidate) => boolean
): Candidate | undefined {
  let best: Candidate | undefined;

  for (const entry of candidates) {
    if (best === undefined || better(entry, best)) best = entry;
  }

  return best;
}

/**
 * Chooses the layout of a group (F198): it is laid out once per size of `PAGE_SIZES`, and the layout
 * with the lowest GL price (`glMb` of every page, of every member left loose) is kept; a layout within
 * 0.5 MiB of it with fewer textures (pages and loose files together) wins, then the lower price, then
 * the smaller page. For `fx` only a layout with no problem counts, so the texture goes to the
 * smallest page that holds it; when none is left, the layout at the largest size comes back with its
 * problems, and the pack fails. A `main` member that fits no page of a layout is priced as loose.
 *
 * @param bundle - Name of the bundle, for the messages.
 * @param group - The atlas group.
 * @param members - Its textures, with the sizes that go on the page.
 * @returns The chosen pages, loose members and problems.
 * @example
 * ```ts
 * chooseLayout("ui", "main", [{ key: "ui.a", width: 8, height: 8 }, { key: "ui.b", width: 8, height: 8 }]).pages.length; // 1
 * ```
 */
export function chooseLayout(bundle: string, group: Group, members: readonly Boxed[]): Layout {
  const candidates = PAGE_SIZES.map(page => candidateOf(bundle, group, members, page));
  const usable =
    group === "fx" ? candidates.filter(entry => entry.layout.problems.length === 0) : candidates;
  const cheapest = Math.min(...usable.map(entry => entry.price));
  const tied = usable.filter(entry => entry.price <= cheapest + TIE_MIB);

  // No size holds the fx group: the largest one names what is wrong.
  const chosen =
    usable.length === 0
      ? bestOf(candidates, (entry, best) => entry.page > best.page)
      : bestOf(tied, beats);

  return chosen?.layout ?? { pages: [], loose: members.toSorted(byKey), problems: [] };
}
