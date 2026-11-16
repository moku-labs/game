import { describe, expect, it } from "vitest";
import type { Boxed, LayoutFrame } from "../../scan/pack/layout";
import {
  BORDER,
  chooseLayout,
  layoutGroup,
  PADDING,
  PAGE_SIZES,
  roomOf
} from "../../scan/pack/layout";

/** A member of a group, by key and size. */
function member(key: string, width: number, height: number): Boxed {
  return { key, width, height };
}

/** The page sizes of the hybrid build: the tests of one size run for each. */
const SIZES = [1024, 2048, 4096];

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

describe("PAGE_SIZES and roomOf", () => {
  it("lists the page sizes smallest first, and a room is the page minus its padding and border", () => {
    // Bug caught: an unsorted list breaks the "smaller page" tie-break; a wrong room lets a frame
    // past the border or refuses one that fits.
    expect(PAGE_SIZES.toSorted((left, right) => left - right)).toEqual(PAGE_SIZES);
    expect(roomOf(1024)).toBe(1018);
    expect(roomOf(2048)).toBe(2042);
    expect(roomOf(4096)).toBe(4090);
  });
});

describe("layoutGroup", () => {
  it("packs every member once, at its own size, never rotated", () => {
    const { pages, problems, loose } = layoutGroup("ui", "main", mixed, 2048);
    const frames = pages.flatMap(page => page.frames);

    expect(problems).toEqual([]);
    expect(loose).toEqual([]);
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
    const [page] = layoutGroup("ui", "main", mixed, 2048).pages;
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
    const [page] = layoutGroup(
      "ui",
      "main",
      [member("ui.a", 100, 50), member("ui.b", 60, 40)],
      2048
    ).pages;
    const frames = page?.frames ?? [];

    expect(page?.width).toBe(Math.max(...frames.map(frame => frame.x + frame.width)) + BORDER);
    expect(page?.height).toBe(Math.max(...frames.map(frame => frame.y + frame.height)) + BORDER);
    expect(page?.width).toBeLessThan(256);
  });

  it.each(
    SIZES
  )("never makes a page past a page size of %i, border and padding counted (F188)", size => {
    // Bug caught: a packer given the page size itself grows a bin to size + padding; four 510 px
    // frames in a row make a 2050 px page (two make 1026 on a 1024 page).
    const squares = Array.from({ length: 16 }, (_, index) =>
      member(`ui.sq-${String(index).padStart(2, "0")}`, 510, 510)
    );
    const { pages, problems } = layoutGroup("ui", "main", squares, size);

    expect(problems).toEqual([]);
    expect(pages.flatMap(page => page.frames)).toHaveLength(16);

    for (const page of pages) {
      expect(page.width).toBeLessThanOrEqual(size);
      expect(page.height).toBeLessThanOrEqual(size);

      for (const frame of page.frames) {
        expect(frame.x + frame.width + BORDER).toBeLessThanOrEqual(page.width);
        expect(frame.y + frame.height + BORDER).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it("packs the largest texture a page holds, and names an fx one a pixel larger (F188)", () => {
    const largest = roomOf(2048);
    const fits = layoutGroup("ui", "fx", [member("ui.fx-full", largest, largest)], 2048);
    const over = layoutGroup("ui", "fx", [member("ui.fx-over", largest + 1, 8)], 2048);

    expect(fits.problems).toEqual([]);
    expect(fits.pages).toEqual([
      {
        width: largest + BORDER * 2,
        height: largest + BORDER * 2,
        frames: [{ key: "ui.fx-full", x: BORDER, y: BORDER, width: largest, height: largest }]
      }
    ]);
    expect(over.problems).toEqual([
      `the texture "ui.fx-over" (2043×8) fits no 2048×2048 page with its 2 px border and 2 px padding.`
    ]);
  });

  it("gives the same layout for the same members in any order", () => {
    expect(layoutGroup("ui", "main", mixed, 2048)).toEqual(
      layoutGroup("ui", "main", mixed.toReversed(), 2048)
    );
  });

  it("hands a main member that fits no page of this size back as loose, with no problem", () => {
    // Bug caught: the old unfit rule failed the whole pack on a texture a larger page holds.
    const room = roomOf(1024);
    const { pages, loose, problems } = layoutGroup(
      "ui",
      "main",
      [member("ui.wide", room + 1, 8), member("ui.tall", 8, room + 1), member("ui.a", 32, 32)],
      1024
    );

    expect(problems).toEqual([]);
    expect(loose.map(entry => entry.key)).toEqual(["ui.tall", "ui.wide"]);
    expect(pages.flatMap(page => page.frames).map(frame => frame.key)).toEqual(["ui.a"]);
  });

  it("names an fx member above the largest room, with the 4096×4096 page, and packs the rest", () => {
    // Bug caught: an fx texture left loose would sample the wrong page in silence.
    const over = roomOf(4096) + 1;
    const { pages, loose, problems } = layoutGroup(
      "ui",
      "fx",
      [
        member("ui.fx-huge", 4096, 64),
        member("ui.fx-wide", over + 10, 10),
        member("ui.fx-a", 32, 32),
        member("ui.fx-b", 32, 32)
      ],
      4096
    );

    expect(problems).toEqual([
      `the texture "ui.fx-huge" (4096×64) fits no 4096×4096 page with its 2 px border and 2 px padding.`,
      `the texture "ui.fx-wide" (4101×10) fits no 4096×4096 page with its 2 px border and 2 px padding.`
    ]);
    expect(loose).toEqual([]);
    expect(pages.flatMap(page => page.frames).map(frame => frame.key)).toEqual([
      "ui.fx-a",
      "ui.fx-b"
    ]);
  });

  it("reports an fx group that needs more than one page, with the bundle and the count", () => {
    const big = [1, 2, 3, 4, 5].map(index => member(`ui.fx-${index}`, 1100, 1100));
    const { pages, problems } = layoutGroup("ui", "fx", big, 2048);

    expect(pages.length).toBeGreaterThan(1);
    expect(problems).toEqual([
      `the fx textures of bundle "ui" need ${pages.length} pages; a particle emitter binds one. ` +
        "Make them smaller, or move some to another bundle."
    ]);
  });

  it("lets a main group spread over several pages", () => {
    const big = [1, 2, 3, 4, 5].map(index => member(`ui.big-${index}`, 1100, 1100));
    const { pages, problems } = layoutGroup("ui", "main", big, 2048);

    expect(pages.length).toBeGreaterThan(1);
    expect(problems).toEqual([]);
  });

  it("carries the trim of a member onto its frame, and nothing on an untrimmed one", () => {
    // Bug caught: a frame that loses its trim shows a cut texture at the size and place of the cut.
    const trim = { offsetX: 9, offsetY: 4, origWidth: 50, origHeight: 40 };
    const { pages } = layoutGroup(
      "ui",
      "main",
      [{ key: "ui.cut", width: 32, height: 30, trim }, member("ui.whole", 16, 16)],
      2048
    );
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

describe("chooseLayout", () => {
  it("takes smaller pages when they price lower than one large page", () => {
    // Bug caught: always packing to the largest page puts four 1000 px textures on one 2006 px
    // page (20.87 GL MiB) where four 1004 px pages cost 19.89.
    const members = [1, 2, 3, 4].map(index => member(`ui.q-${index}`, 1000, 1000));
    const { pages, loose } = chooseLayout("ui", "main", members);

    expect(loose).toEqual([]);
    expect(pages).toHaveLength(4);

    for (const page of pages) expect(page.width).toBeLessThanOrEqual(1024);
  });

  it("takes one page over four when the prices lie within 0.5 MiB", () => {
    // Bug caught: with no tie rule the cheaper-by-0.4 layout of four pages wins, and the phone pays
    // for four textures and three more draw-call batches.
    const members = [1, 2, 3, 4].map(index => member(`ui.q-${index}`, 980, 980));
    const { pages } = chooseLayout("ui", "main", members);

    expect(pages).toHaveLength(1);
    // The smaller page of two equal layouts: 2048 and 4096 write the same content.
    expect(pages[0]?.width).toBe(1966);
  });

  it("packs a 2000 px member on a page that holds it when that prices lower than leaving it loose", () => {
    // Bug caught: pricing a loose member by its cut instead of its original size, or never trying
    // the page that holds it, leaves the texture a file of its own at 10.9 GL MiB instead of 9.9.
    const trim = { offsetX: 50, offsetY: 50, origWidth: 2000, origHeight: 1000 };
    const { pages, loose } = chooseLayout("ui", "main", [
      { key: "ui.big", width: 1900, height: 900, trim },
      member("ui.a", 50, 50)
    ]);

    expect(loose).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.frames.map(frame => frame.key)).toEqual(["ui.a", "ui.big"]);
  });

  it("leaves a 2000 px member loose when its page costs more than the file", () => {
    // Bug caught: a page of 2004×1056 (11.5 GL MiB) for an untrimmed 2000×1000 member costs more
    // than the loose file (10.9), so the member must stay loose.
    const { pages, loose } = chooseLayout("ui", "main", [
      member("ui.big", 2000, 1000),
      member("ui.a", 50, 50),
      member("ui.b", 50, 50)
    ]);

    expect(loose.map(entry => entry.key)).toEqual(["ui.big"]);
    expect(pages.flatMap(page => page.frames).map(frame => frame.key)).toEqual(["ui.a", "ui.b"]);
  });

  it("leaves a lone packed member loose: a page of one gains nothing", () => {
    // Bug caught: a page of one texture costs its padding and a request, and saves nothing.
    const { pages, loose, problems } = chooseLayout("ui", "main", [member("ui.a", 50, 50)]);

    expect(pages).toEqual([]);
    expect(loose.map(entry => entry.key)).toEqual(["ui.a"]);
    expect(problems).toEqual([]);
  });

  it("gives an fx group the smallest page size that holds it with no problem", () => {
    // Bug caught: choosing a layout with a problem (a 1024 page that cannot hold the texture)
    // because it prices lower would fail a pack a 2048 page passes.
    const { pages, problems } = chooseLayout("ui", "fx", [
      member("ui.fx-a", 1500, 100),
      member("ui.fx-b", 10, 10)
    ]);

    expect(problems).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.frames).toHaveLength(2);
  });

  it("fails an fx texture above the largest room with the largest page named, never loose", () => {
    // Bug caught: an oversized fx texture left loose would sample the wrong page in silence.
    const { loose, problems } = chooseLayout("ui", "fx", [
      member("ui.fx-a", roomOf(4096) + 1, 100),
      member("ui.fx-b", 10, 10)
    ]);

    expect(loose).toEqual([]);
    expect(problems).toEqual([
      `the texture "ui.fx-a" (4091×100) fits no 4096×4096 page with its 2 px border and 2 px padding.`
    ]);
  });

  it("gives the same choice for the same members in any order", () => {
    expect(chooseLayout("ui", "main", mixed)).toEqual(
      chooseLayout("ui", "main", mixed.toReversed())
    );
  });
});
