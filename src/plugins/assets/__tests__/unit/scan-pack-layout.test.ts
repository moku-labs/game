import { describe, expect, it } from "vitest";
import type { Boxed, LayoutFrame } from "../../scan/pack/layout";
import { BORDER, layoutGroup, PACKER_SIZE, PADDING, PAGE_SIZE } from "../../scan/pack/layout";

/** A member of a group, by key and size. */
function member(key: string, width: number, height: number): Boxed {
  return { key, width, height };
}

/** The largest side of a frame a page holds, inside its border (F188). */
const ROOM = PAGE_SIZE - PADDING - BORDER * 2;

/** Twelve members of mixed sizes, enough to fill a page in several rows. */
const mixed = [
  member("ui.a", 120, 80),
  member("ui.b", 64, 64),
  member("ui.c", 200, 30),
  member("ui.d", 33, 190),
  member("ui.e", 90, 90),
  member("ui.f", 15, 15),
  member("ui.g", 256, 128),
  member("ui.h", 48, 100),
  member("ui.i", 77, 41),
  member("ui.j", 10, 300),
  member("ui.k", 128, 128),
  member("ui.l", 500, 12)
];

/**
 * Tells whether two frames come closer than the padding.
 *
 * @param left - One frame.
 * @param right - Another frame.
 * @returns True when the gap between them is below the padding on both axes.
 */
function tooClose(left: LayoutFrame, right: LayoutFrame): boolean {
  const apartX =
    left.x + left.width + PADDING <= right.x || right.x + right.width + PADDING <= left.x;
  const apartY =
    left.y + left.height + PADDING <= right.y || right.y + right.height + PADDING <= left.y;

  return !apartX && !apartY;
}

describe("page size", () => {
  it("is one 2048 px page and a packer two pixels smaller, so a bin never passes it (F188)", () => {
    // Bug caught: a packer given the page size itself grows a bin to size + padding (2050 px).
    expect(PAGE_SIZE).toBe(2048);
    expect(PACKER_SIZE).toBe(PAGE_SIZE - PADDING);
  });
});

describe("layoutGroup", () => {
  it("packs every member once, at its own size, never rotated", () => {
    const { pages, problems } = layoutGroup("ui", "main", mixed);
    const frames = pages.flatMap(page => page.frames);

    expect(problems).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(frames.map(frame => frame.key).toSorted()).toEqual(mixed.map(entry => entry.key));

    for (const frame of frames) {
      const source = mixed.find(entry => entry.key === frame.key);

      expect({ width: frame.width, height: frame.height }).toEqual({
        width: source?.width,
        height: source?.height
      });
    }
  });

  it("keeps the padding between frames and the border around them", () => {
    const [page] = layoutGroup("ui", "main", mixed).pages;
    const frames = page?.frames ?? [];

    for (const frame of frames) {
      expect(frame.x).toBeGreaterThanOrEqual(BORDER);
      expect(frame.y).toBeGreaterThanOrEqual(BORDER);
      expect(frame.x + frame.width).toBeLessThanOrEqual((page?.width ?? 0) - BORDER);
      expect(frame.y + frame.height).toBeLessThanOrEqual((page?.height ?? 0) - BORDER);
    }

    for (const [index, frame] of frames.entries()) {
      for (const other of frames.slice(index + 1)) expect(tooClose(frame, other)).toBe(false);
    }
  });

  it("makes a page as small as its content, not a power of two", () => {
    const [page] = layoutGroup("ui", "main", [
      member("ui.a", 100, 50),
      member("ui.b", 60, 40)
    ]).pages;
    const frames = page?.frames ?? [];

    expect(page?.width).toBe(Math.max(...frames.map(frame => frame.x + frame.width)) + BORDER);
    expect(page?.height).toBe(Math.max(...frames.map(frame => frame.y + frame.height)) + BORDER);
    expect(page?.width).toBeLessThan(256);
  });

  it("never makes a page past 2048 × 2048, border and padding counted (F188)", () => {
    // Bug caught: four 510 px frames in a row need 4 × 510 + 3 × 2 + 2 × 2 = 2050 px; a packer
    // given the page size itself lets them share a row.
    const squares = Array.from({ length: 16 }, (_, index) =>
      member(`ui.sq-${String(index).padStart(2, "0")}`, 510, 510)
    );
    const { pages, problems } = layoutGroup("ui", "main", squares);

    expect(problems).toEqual([]);
    expect(pages.flatMap(page => page.frames)).toHaveLength(16);

    for (const page of pages) {
      expect(page.width).toBeLessThanOrEqual(PAGE_SIZE);
      expect(page.height).toBeLessThanOrEqual(PAGE_SIZE);

      for (const frame of page.frames) {
        expect(frame.x + frame.width + BORDER).toBeLessThanOrEqual(page.width);
        expect(frame.y + frame.height + BORDER).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it("packs the largest texture a page holds, and names an fx one a pixel larger (F188)", () => {
    // Bug caught: a wrong room refuses a texture that fits, or lets one past the border.
    const fits = layoutGroup("ui", "fx", [member("ui.fx-full", ROOM, ROOM)]);
    const over = layoutGroup("ui", "fx", [member("ui.fx-over", ROOM + 1, 8)]);

    expect(ROOM).toBe(2042);
    expect(fits.problems).toEqual([]);
    expect(fits.pages).toEqual([
      {
        width: ROOM + BORDER * 2,
        height: ROOM + BORDER * 2,
        frames: [{ key: "ui.fx-full", x: BORDER, y: BORDER, width: ROOM, height: ROOM }]
      }
    ]);
    expect(over.problems).toEqual([
      `the texture "ui.fx-over" (2043×8) fits no 2048×2048 page with its 2 px border and 2 px padding.`
    ]);
  });

  it("gives the same layout for the same members in any order", () => {
    expect(layoutGroup("ui", "main", mixed)).toEqual(layoutGroup("ui", "main", mixed.toReversed()));
  });

  it("reports an fx member that fits no page by its key, and packs the rest", () => {
    // Bug caught: an fx texture left loose would sample the wrong page in silence.
    const { pages, problems } = layoutGroup("ui", "fx", [
      member("ui.fx-huge", PAGE_SIZE, 64),
      member("ui.fx-wide", PAGE_SIZE + 10, 10),
      member("ui.fx-a", 32, 32),
      member("ui.fx-b", 32, 32)
    ]);

    expect(problems).toEqual([
      `the texture "ui.fx-huge" (2048×64) fits no 2048×2048 page with its 2 px border and 2 px padding.`,
      `the texture "ui.fx-wide" (2058×10) fits no 2048×2048 page with its 2 px border and 2 px padding.`
    ]);
    expect(pages.flatMap(page => page.frames).map(frame => frame.key)).toEqual([
      "ui.fx-a",
      "ui.fx-b"
    ]);
  });

  it("reports a main member above a page the same way: the groups keep it from here", () => {
    // Bug caught: a main member too large for a page vanishing, or failing with no key.
    const { pages, problems } = layoutGroup("ui", "main", [
      member("ui.wide", ROOM + 1, 8),
      member("ui.tall", 8, ROOM + 1),
      member("ui.a", 32, 32),
      member("ui.b", 32, 32)
    ]);

    expect(problems).toEqual([
      `the texture "ui.tall" (8×2043) fits no 2048×2048 page with its 2 px border and 2 px padding.`,
      `the texture "ui.wide" (2043×8) fits no 2048×2048 page with its 2 px border and 2 px padding.`
    ]);
    expect(pages.flatMap(page => page.frames).map(frame => frame.key)).toEqual(["ui.a", "ui.b"]);
  });

  it("reports an fx group that needs more than one page, with the bundle and the count", () => {
    const big = [1, 2, 3, 4, 5].map(index => member(`ui.fx-${index}`, 1100, 1100));
    const { pages, problems } = layoutGroup("ui", "fx", big);

    expect(pages.length).toBeGreaterThan(1);
    expect(problems).toEqual([
      `the fx textures of bundle "ui" need ${pages.length} pages; a particle emitter binds one. ` +
        "Make them smaller, or move some to another bundle."
    ]);
  });

  it("lets a main group spread over several pages", () => {
    const big = [1, 2, 3, 4, 5].map(index => member(`ui.big-${index}`, 1100, 1100));
    const { pages, problems } = layoutGroup("ui", "main", big);

    expect(pages.length).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });

  it("carries the trim of a member onto its frame, and nothing on an untrimmed one", () => {
    // Bug caught: a frame that loses its trim shows a cut texture at the size and place of the cut.
    const trim = { offsetX: 9, offsetY: 4, origWidth: 50, origHeight: 40 };
    const { pages } = layoutGroup("ui", "main", [
      { key: "ui.cut", width: 32, height: 30, trim },
      member("ui.whole", 16, 16)
    ]);
    const frames = pages.flatMap(page => page.frames);

    expect(frames.find(frame => frame.key === "ui.cut")).toMatchObject({
      width: 32,
      height: 30,
      ...trim
    });
    expect(Object.keys(frames.find(frame => frame.key === "ui.whole") ?? {})).toEqual([
      "key",
      "x",
      "y",
      "width",
      "height"
    ]);
  });
});
