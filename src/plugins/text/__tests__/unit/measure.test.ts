import { describe, expect, it } from "vitest";
import { boldLookOf } from "../../components";
import { fontLineOf, lineHeightOf } from "../../lines";
import { layoutRuns, measureRun, parseAdvances } from "../../measure";
import type { AdvanceTable, LayoutOptions, Run, TextRun, TextStyle, Warn } from "../../types";
import { latinFontJson, miniFontJson, miniFontXml } from "../fixtures/mini-font";

// ---------------------------------------------------------------------------
// The measurement is pure: runs, a style and the advance tables in, lines and
// a size out. Every expected number below is the fixture's own advance times
// `style.size / 32`, so the arithmetic is visible in the test.
// ---------------------------------------------------------------------------

/** The fixture body style; a case overrides what it is about. */
function style(over: Partial<TextStyle> = {}): TextStyle {
  return {
    font: "ui.font-body",
    bold: undefined,
    italic: undefined,
    size: 32,
    fill: 0xff_ff_ff,
    stroke: 0x00_00_00,
    strokeWidth: 0,
    letterSpacing: 0,
    align: "left",
    wrap: "none",
    digits: false,
    shadow: undefined,
    lineHeight: undefined,
    ...over
  };
}

/** The fixture tables, under the font keys a style may name. */
function tables(fnt: string = miniFontJson): Map<string, AdvanceTable> {
  return new Map([["ui.font-body", parseAdvances(fnt, "ui.font-body")]]);
}

/** One plain run of glyphs. */
function text(value: string, over: Partial<TextRun> = {}): TextRun {
  return {
    kind: "text",
    text: value,
    bold: false,
    italic: false,
    color: undefined,
    span: undefined,
    ...over
  };
}

/** The options a layout takes, with the warnings collected. */
function options(): LayoutOptions & { written: string[] } {
  const written: string[] = [];
  const warn: Warn = (key): void => {
    written.push(key);
  };

  return { warn, written };
}

describe("parseAdvances", () => {
  it("reads BMFont JSON: the export size, the line height and one advance per char", () => {
    const table = parseAdvances(miniFontJson, "ui.font-body");

    expect(table.size).toBe(32);
    expect(table.lineHeight).toBe(40);
    expect(table.advances.get("1")).toBe(16);
    expect(table.advances.get("A")).toBe(24);
  });

  it("reads BMFont XML into the same table", () => {
    expect(parseAdvances(miniFontXml, "ui.font-body")).toEqual(
      parseAdvances(miniFontJson, "ui.font-body")
    );
  });

  it('reads a glyph whose attribute value holds a > (msdf-bmfont-xml writes char=">")', () => {
    const fnt =
      '<?xml version="1.0"?><font><info face="f" size="48"/><common lineHeight="57"/>' +
      '<chars count="2"><char id="62" index="1" char=">" xadvance="27"/>' +
      '<char id="65" index="2" char="A" xadvance="30"/></chars></font>';
    const table = parseAdvances(fnt, "ui.font-display");

    expect(table.advances.get(">")).toBe(27);
    expect(table.advances.get("A")).toBe(30);
  });

  // The bug: the baseline of a font is dropped, so a run of another font cannot stand on the
  // baseline of its line.
  it("reads the baseline of the font from JSON and XML", () => {
    expect(parseAdvances(miniFontJson, "ui.font-body").base).toBe(32);
    expect(parseAdvances(miniFontXml, "ui.font-body").base).toBe(32);
  });

  // The bug: a file with no base, or a base of 0, puts every glyph on the top of its line.
  it("puts the baseline at 0.8 of the size when the file names none above 0", () => {
    const json = '{"info":{"size":40},"common":{"lineHeight":50},"chars":[]}';
    const zero = '{"info":{"size":40},"common":{"lineHeight":50,"base":0},"chars":[]}';
    const xml = '<font><info size="40"/><common lineHeight="50"/><chars count="0"></chars></font>';

    expect(parseAdvances(json, "f").base).toBe(32);
    expect(parseAdvances(zero, "f").base).toBe(32);
    expect(parseAdvances(xml, "f").base).toBe(32);
  });

  it("refuses a file that is neither format", () => {
    expect(() => parseAdvances("not a font at all", "ui.font-body")).toThrow(
      '[game] Font "ui.font-body" is not BMFont XML or JSON.\n' +
        "  Export the MSDF font with a BMFont .fnt file."
    );
  });
});

describe("layoutRuns — one line", () => {
  it("adds the advances of the glyphs and takes the height from the table", () => {
    const layout = layoutRuns([text("12")], style(), tables(), options());

    expect(layout).toEqual({
      lines: [{ runs: [text("12")], width: 36, height: 40, baseline: 32 }],
      width: 36,
      height: 40
    });
  });

  it("answers the same lines and size for a style with a shadow", () => {
    const shadow = { color: 0x5b_3a_1e, dx: 6, dy: 8, alpha: 1 };
    const plain = layoutRuns([text("12"), text("A")], style(), tables(), options());
    const shadowed = layoutRuns([text("12"), text("A")], style({ shadow }), tables(), options());

    expect(shadowed).toEqual(plain);
  });

  it("scales both the advances and the line height by size over export size", () => {
    const layout = layoutRuns([text("12")], style({ size: 64 }), tables(), options());

    expect(layout.width).toBe(72);
    expect(layout.height).toBe(80);
  });

  it("adds the letter spacing to every glyph", () => {
    const layout = layoutRuns([text("12")], style({ letterSpacing: 2 }), tables(), options());

    expect(layout.width).toBe(40);
  });

  it("measures a character the font lacks 0 wide, as Pixi draws nothing for it", () => {
    const latin = tables(latinFontJson);
    const written = options();
    const withEmoji = layoutRuns([text("ab😀")], style(), latin, written);

    expect(withEmoji.width).toBe(layoutRuns([text("ab")], style(), latin, options()).width);
    expect(withEmoji.width).toBe(38);
    expect(written.written).toEqual(["glyph:ui.font-body:😀"]);
  });

  it("adds no letter spacing for a character the font lacks, even with a □ in the font", () => {
    const layout = layoutRuns([text("1Z")], style({ letterSpacing: 2 }), tables(), options());

    expect(layout.width).toBe(18);
  });

  it("makes an icon run as wide as the line is high", () => {
    const layout = layoutRuns(
      [{ kind: "icon", key: "hud.coin", span: undefined }],
      style(),
      tables(),
      options()
    );

    expect(layout.width).toBe(40);
    expect(layout.height).toBe(40);
  });

  it("uses the bold font of the style for a bold run", () => {
    const bolder = parseAdvances(miniFontJson, "ui.font-bold");
    const withBold = tables();

    withBold.set("ui.font-bold", { ...bolder, advances: new Map([["1", 32]]) });

    const layout = layoutRuns(
      [text("1", { bold: true })],
      style({ bold: "ui.font-bold" }),
      withBold,
      options()
    );

    expect(layout.width).toBe(32);
  });

  it("answers the width of one run on its own, for the display", () => {
    expect(measureRun(text("A"), style(), tables(), options())).toBe(24);
  });
});

describe("layoutRuns — many lines", () => {
  it("breaks on a line break in every style", () => {
    const layout = layoutRuns([text("A\nA")], style(), tables(), options());

    expect(layout.lines).toHaveLength(2);
    expect(layout.width).toBe(24);
    expect(layout.height).toBe(80);
  });

  it("keeps a word that fits on the line", () => {
    const layout = layoutRuns([text("A A")], style({ wrap: 60 }), tables(), options());

    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(56);
  });

  it("moves a word that does not fit to the next line", () => {
    const layout = layoutRuns([text("A A A")], style({ wrap: 60 }), tables(), options());

    expect(layout.lines.map(line => line.width)).toEqual([56, 24]);
    expect(layout.width).toBe(56);
    expect(layout.height).toBe(80);
  });

  it("breaks a word wider than the wrap by glyphs", () => {
    const layout = layoutRuns([text("AAA")], style({ wrap: 40 }), tables(), options());

    expect(layout.lines.map(line => line.width)).toEqual([24, 24, 24]);
  });

  it("keeps a word that spans two runs together", () => {
    const layout = layoutRuns(
      [text("A"), text("A", { bold: true })],
      style({ wrap: 40 }),
      tables(),
      options()
    );

    expect(layout.lines.map(line => line.width)).toEqual([24, 24]);
  });

  it("breaks on a line break inside a wrapped style", () => {
    const layout = layoutRuns([text("A\nA A")], style({ wrap: 200 }), tables(), options());

    expect(layout.lines.map(line => line.width)).toEqual([24, 56]);
  });

  it("leaves the measured size alone whatever the alignment is", () => {
    const left = layoutRuns([text("A\n12")], style(), tables(), options());
    const centre = layoutRuns([text("A\n12")], style({ align: "center" }), tables(), options());

    expect(centre.width).toBe(left.width);
    expect(centre.height).toBe(left.height);
  });
});

describe("the line of a style", () => {
  // The fixture font: a line of 40 at an export size of 32, so 17.5 at size 14; 16.8 headless.

  it("is the font's line when the style names no lineHeight", () => {
    expect(lineHeightOf(style({ size: 14 }), tables())).toBe(17.5);
    expect(lineHeightOf(style({ size: 14 }), new Map())).toBeCloseTo(16.8, 10);
  });

  // The bug: the font's line wins over the line the style asked for, with or without a font.
  it("is lineHeight times size when the style names one, whatever font is loaded", () => {
    const plate = style({ size: 14, lineHeight: 1.28 });

    expect(lineHeightOf(plate, tables())).toBeCloseTo(17.92, 10);
    expect(lineHeightOf(plate, new Map())).toBeCloseTo(17.92, 10);
  });

  // The bug: the font's line reads the style's lineHeight, so the glyphs get no half-leading.
  it("keeps the font's own line apart from the line the style asked for", () => {
    expect(fontLineOf(style({ size: 14, lineHeight: 1.28 }), tables())).toBe(17.5);
  });

  it("lays three lines out at three of those lines", () => {
    const plate = style({ size: 14, lineHeight: 1.28 });
    const layout = layoutRuns([text("A\nA\nA")], plate, tables(), options());

    expect(layout.lines).toHaveLength(3);
    expect(layout.height).toBeCloseTo(53.76, 10);
  });

  // The bug: the line height leaks into the advances, so a taller line wraps its words elsewhere.
  it("wraps the glyphs at the same widths as the font's line does", () => {
    const tall = layoutRuns(
      [text("A A A")],
      style({ wrap: 60, lineHeight: 2 }),
      tables(),
      options()
    );

    expect(tall.lines.map(line => line.width)).toEqual([56, 24]);
    expect(tall.width).toBe(56);
  });
});

describe("layoutRuns — wrap box", () => {
  // The bug: a "box" style ignores the width ui laid its text out at, or lays it out at a box of 0.
  it("wraps a box style at the box it is handed", () => {
    const layout = layoutRuns([text("A A A")], style({ wrap: "box" }), tables(), options(), 60);

    expect(layout.lines.map(line => line.width)).toEqual([56, 24]);
    expect(layout.height).toBe(80);
  });

  // The bug: ui lays a text out in whole units, rounding its measure with a tolerance of 0.0001.
  // Ten glyphs of 14.4 add up to 144.00000000000003 and get a box of 144: a line a hair wider than
  // its box broke there when drawn, one line more than the element is high.
  it("keeps a line a hair over a whole-unit box on that line", () => {
    const small = style({ wrap: "box", size: 24 });
    const layout = layoutRuns([text("AAAAAAAAAA")], small, new Map(), options(), 144);

    expect(layout.width).toBeGreaterThan(144);
    expect(layout.lines).toHaveLength(1);
  });

  // The bug: the box of the element reflows a label whose style draws it on one line.
  it("ignores the box in a style with no wrap", () => {
    const none = layoutRuns([text("A A A")], style(), tables(), options(), 40);

    expect(none.lines.map(line => line.width)).toEqual([88]);
  });
});

describe("layoutRuns — the headless fallback", () => {
  it("advances 0.6 em per glyph and 1.2 em per line, and names the font once", () => {
    const written = options();
    const layout = layoutRuns([text("12"), text("A")], style(), new Map(), written);

    expect(layout.width).toBeCloseTo(57.6, 5);
    expect(layout.height).toBeCloseTo(38.4, 5);
    expect(written.written).toEqual(["font:ui.font-body"]);
  });
});

describe("layoutRuns — icons inside wrapped text", () => {
  /** The coin icon of the cases. */
  const coin: Run = { kind: "icon", key: "hud.coin", span: undefined };

  it("keeps an icon that fits on the line, as wide as the line is high", () => {
    const written = options();
    const layout = layoutRuns([text("A "), coin], style({ wrap: 200 }), tables(), written);

    expect(layout.lines).toEqual([
      { runs: [text("A "), coin], width: 72, height: 40, baseline: 32 }
    ]);
    expect(layout.height).toBe(40);
    expect(written.written).toEqual([]);
  });

  it("adds the letter spacing to the icon as to a glyph", () => {
    const layout = layoutRuns(
      [text("A "), coin],
      style({ wrap: 200, letterSpacing: 2 }),
      tables(),
      options()
    );

    expect(layout.width).toBe(78);
  });

  it("moves an icon that does not fit to the next line with its word", () => {
    const written = options();
    const layout = layoutRuns(
      [text("A A"), coin, text("1")],
      style({ wrap: 80 }),
      tables(),
      written
    );

    expect(layout.lines).toEqual([
      { runs: [text("A")], width: 24, height: 40, baseline: 32 },
      { runs: [text("A"), coin, text("1")], width: 80, height: 40, baseline: 32 }
    ]);
    expect(layout.height).toBe(80);
    expect(written.written).toEqual([]);
  });

  it("makes the glyphs touching an icon one word with it", () => {
    const layout = layoutRuns(
      [text("A 2"), coin, text("1")],
      style({ wrap: 90 }),
      tables(),
      options()
    );

    // "2", the coin and "1" move together: 20 + 40 + 16.
    expect(layout.lines.map(line => line.width)).toEqual([24, 76]);
  });

  it("makes an icon between two spaces a word of its own", () => {
    const layout = layoutRuns(
      [text("A "), coin, text(" A")],
      style({ wrap: 60 }),
      tables(),
      options()
    );

    expect(layout.lines).toEqual([
      { runs: [text("A")], width: 24, height: 40, baseline: 32 },
      { runs: [coin], width: 40, height: 40, baseline: 32 },
      { runs: [text("A")], width: 24, height: 40, baseline: 32 }
    ]);
  });

  it("breaks a word with an icon wider than the wrap by glyphs, the icon one piece", () => {
    const layout = layoutRuns(
      [text("2"), coin, text("1")],
      style({ wrap: 50 }),
      tables(),
      options()
    );

    expect(layout.lines).toEqual([
      { runs: [text("2")], width: 20, height: 40, baseline: 32 },
      { runs: [coin], width: 40, height: 40, baseline: 32 },
      { runs: [text("1")], width: 16, height: 40, baseline: 32 }
    ]);
  });

  it("gives an icon wider than the wrap a line of its own, never dropping it", () => {
    const written = options();
    const alone = layoutRuns([coin], style({ wrap: 10 }), tables(), written);
    const between = layoutRuns(
      [text("A "), coin, text(" A")],
      style({ wrap: 30 }),
      tables(),
      written
    );

    expect(alone.lines).toEqual([{ runs: [coin], width: 40, height: 40, baseline: 32 }]);
    expect(between.lines.map(line => line.runs)).toEqual([[text("A")], [coin], [text("A")]]);
    expect(written.written).toEqual([]);
  });

  it("keeps the icon a run of its own next to text with the same flags", () => {
    const layout = layoutRuns(
      [text("1"), coin, text("2")],
      style({ wrap: 200 }),
      tables(),
      options()
    );

    expect(layout.lines[0]?.runs).toEqual([text("1"), coin, text("2")]);
  });

  it("measures the icon at 1.2 em when no font is loaded", () => {
    const written = options();
    const layout = layoutRuns([text("A "), coin], style({ wrap: 60 }), new Map(), written);

    expect(layout.lines.map(line => line.width)).toEqual([
      expect.closeTo(19.2, 5),
      expect.closeTo(38.4, 5)
    ]);
    expect(layout.height).toBeCloseTo(76.8, 5);
    expect(written.written).toEqual(["font:ui.font-body"]);
  });
});

/** The fixture glyphs plus `-` and U+2010, each 10 wide at size 32. */
function hyphenTables(): Map<string, AdvanceTable> {
  return new Map([
    [
      "ui.font-body",
      parseAdvances(
        JSON.stringify({
          info: { size: 32 },
          common: { lineHeight: 40 },
          chars: [
            { char: "1", xadvance: 16 },
            { char: "A", xadvance: 24 },
            { char: " ", xadvance: 8 },
            { char: "-", xadvance: 10 },
            { char: "\u2010", xadvance: 10 }
          ]
        }),
        "ui.font-body"
      )
    ]
  ]);
}

/** The glyphs of every line, as the display draws them. */
function linesOf(value: string, wrap: number, written = options()): string[] {
  return layoutRuns([text(value)], style({ wrap }), hyphenTables(), written).lines.map(line =>
    line.runs.map(run => (run.kind === "text" ? run.text : "")).join("")
  );
}

describe("breaks inside a word (F138)", () => {
  it("breaks after a hyphen inside a word and keeps the hyphen on the first line", () => {
    const layout = layoutRuns([text("A A-A")], style({ wrap: 70 }), hyphenTables(), options());

    expect(linesOf("A A-A", 70)).toEqual(["A A-", "A"]);
    expect(layout.lines.map(line => line.width)).toEqual([66, 24]);
  });

  it("breaks after the hyphen U+2010 the same way", () => {
    expect(linesOf("A A‐A", 70)).toEqual(["A A‐", "A"]);
  });

  it("does not break after a leading hyphen or before a digit", () => {
    expect(linesOf("A -A", 50)).toEqual(["A", "-A"]);
    expect(linesOf("A A-1", 70)).toEqual(["A", "A-1"]);
  });

  it("draws a soft hyphen as - where the line breaks at it", () => {
    const layout = layoutRuns([text("A A­A")], style({ wrap: 70 }), hyphenTables(), options());

    expect(linesOf("A A­A", 70)).toEqual(["A A-", "A"]);
    expect(layout.lines.map(line => line.width)).toEqual([66, 24]);
  });

  it("draws nothing for a soft hyphen the line does not break at, and warns of nothing", () => {
    const written = options();
    const fixed = layoutRuns([text("A­A")], style(), hyphenTables(), written);

    expect(linesOf("A­A", 200, written)).toEqual(["AA"]);
    expect(fixed.lines.map(line => line.width)).toEqual([48]);
    expect(written.written).toEqual([]);
  });

  it("breaks before the word when the hyphen of a soft hyphen would stand past the wrap", () => {
    expect(linesOf("A A­A", 60)).toEqual(["A", "AA"]);
  });
});

// ---------------------------------------------------------------------------
// F148: `balance` evens the lines of a wrapped block. The cases are in a
// monospace font, every glyph 10 wide at size 32, so a line is ten times its
// characters and the request's own sentence can be laid out as it was seen.
// ---------------------------------------------------------------------------

/** The sentence of the request: greedy it leaves «один.» alone on its second line. */
const HINT = "Здесь то, что ждут ваши заказы. Возьмите один.";

/** Every character of the balance cases, each 10 wide: a monospace font. */
function monoTables(): Map<string, AdvanceTable> {
  const chars = [...new Set(`${HINT}ABC-`)].map(char => ({ char, xadvance: 10 }));
  const fnt = JSON.stringify({ info: { size: 32 }, common: { lineHeight: 40 }, chars });

  return new Map([["ui.font-body", parseAdvances(fnt, "ui.font-body")]]);
}

/**
 * The glyphs of every line of a block in the monospace font.
 *
 * @param value - The text.
 * @param over - The wrap of the style, and `balance` when the case balances.
 * @param box - The box a `"box"` style wraps at.
 * @returns One string per line.
 */
function monoLines(value: string, over: Partial<TextStyle>, box = 0): string[] {
  return layoutRuns([text(value)], style(over), monoTables(), options(), box).lines.map(line =>
    line.runs.map(run => (run.kind === "text" ? run.text : "")).join("")
  );
}

describe("layoutRuns — balance (F148)", () => {
  // The bug: balance is ignored and the hint keeps one word on its last line; or the second pass
  // reads tokens the first pass merged into (`appendRun` writing into a token's own run), and the
  // balanced lines repeat the text.
  it("evens a two-line block whose last line is one word, as the request shows", () => {
    const layout = layoutRuns([text(HINT)], style({ wrap: 420, balance: true }), monoTables(), {
      warn: () => undefined
    });

    expect(monoLines(HINT, { wrap: 420 })).toEqual([
      "Здесь то, что ждут ваши заказы. Возьмите",
      "один."
    ]);
    expect(monoLines(HINT, { wrap: 420, balance: true })).toEqual([
      "Здесь то, что ждут ваши",
      "заказы. Возьмите один."
    ]);
    expect(layout.lines.map(line => line.width)).toEqual([230, 220]);
    expect(layout.width).toBe(230);
  });

  // The bug: the search stops early or keeps the wrong end, and a three-line block is laid out
  // wider than the narrowest width that keeps three lines (170: one less makes four).
  it("lays a three-line block at the narrowest width that keeps three lines", () => {
    expect(monoLines(HINT, { wrap: 200 })).toEqual([
      "Здесь то, что ждут",
      "ваши заказы.",
      "Возьмите один."
    ]);
    expect(monoLines(HINT, { wrap: 200, balance: true })).toEqual([
      "Здесь то, что",
      "ждут ваши заказы.",
      "Возьмите один."
    ]);
  });

  // The bug: the search runs above the wrap (from 59 to 73 «Возьмите» is wider than it), or lands
  // on a width that wraps to a line more; the label then overflows its box, or ui gave it a height
  // one line short.
  it("keeps every line within the wrap and the greedy number of lines, at every wrap", () => {
    for (let wrap = 59; wrap <= 470; wrap += 7) {
      const greedy = layoutRuns([text(HINT)], style({ wrap }), monoTables(), options());
      const even = layoutRuns(
        [text(HINT)],
        style({ wrap, balance: true }),
        monoTables(),
        options()
      );

      expect(even.lines).toHaveLength(greedy.lines.length);
      expect(even.width).toBeLessThanOrEqual(Math.min(wrap, greedy.width));
    }
  });

  // The bug: the cap of six lines is gone or off by one, and a long block pays the search and
  // reflows where Chrome keeps it greedy.
  it("balances up to six lines and keeps the greedy lines past six, as Chrome", () => {
    const six = Array.from({ length: 3 }, () => HINT).join("\n");
    const eight = Array.from({ length: 4 }, () => HINT).join("\n");

    expect(monoLines(six, { wrap: 420, balance: true })).toEqual(
      Array.from({ length: 3 }, () => ["Здесь то, что ждут ваши", "заказы. Возьмите один."]).flat()
    );
    expect(monoLines(eight, { wrap: 420, balance: true })).toEqual(monoLines(eight, { wrap: 420 }));
  });

  // The bug: a word wider than the wrap breaks between glyphs at a narrower width than the wrap,
  // so its first line is cut shorter than the greedy layout cuts it ("AAAAA" instead of "AAAAAA");
  // or the search starts at that word and climbs past the wrap, where "1 1 1" (64) fits a line.
  it("keeps the greedy lines when a word is wider than the wrap", () => {
    const even = style({ wrap: 60, balance: true });
    const wide = layoutRuns([text("AAA 1 1 1 1")], even, hyphenTables(), options());

    expect(monoLines("AAAAAAA BB CC", { wrap: 60, balance: true })).toEqual([
      "AAAAAA",
      "A BB",
      "CC"
    ]);
    expect(wide.lines.map(line => line.width)).toEqual([48, 48, 40, 16]);
  });

  // The bug: the balanced pass loses the breaks inside a word (F138), or draws the `-` of a soft
  // hyphen it did not break at.
  it("breaks at a soft hyphen and after a hyphen inside a balanced block", () => {
    expect(monoLines("AA BB­BBBBBB CC", { wrap: 120 })).toEqual(["AA BBBBBBBB", "CC"]);
    expect(monoLines("AA BB­BBBBBB CC", { wrap: 120, balance: true })).toEqual([
      "AA BB-",
      "BBBBBB CC"
    ]);
    expect(monoLines("AA BB-BBBBB CC", { wrap: 120, balance: true })).toEqual([
      "AA BB-",
      "BBBBB CC"
    ]);
    expect(monoLines("Возьмите за­казы.", { wrap: 120, balance: true })).toEqual([
      "Возьмите",
      "заказы."
    ]);
  });

  // The bug: balance reads only a numeric wrap, so a name that wraps at its box keeps its lone
  // word; or it wraps a box style that has no box.
  it("balances a box style at its box and leaves it one line without one", () => {
    expect(monoLines(HINT, { wrap: "box", balance: true }, 420)).toEqual([
      "Здесь то, что ждут ваши",
      "заказы. Возьмите один."
    ]);
    expect(monoLines(HINT, { wrap: "box", balance: true })).toEqual([HINT]);
  });
});

// ---------------------------------------------------------------------------
// F152: pieces of another look. The game's line «<b>140★</b> можно потратить»
// on two mono fonts whose baselines sit apart: text-medium is 32 px with a
// line of 48 and a baseline of 24, every glyph 16 wide; alt-bold is 32 px
// with a line of 36 and a baseline of 32, every glyph 20 wide. At 13 px a
// glyph is 6.5, a line 19.5 and the baseline 9.75; at 16 px of alt-bold a
// glyph is 10, a line 18 and the baseline 16.
// ---------------------------------------------------------------------------

/** The font of the game's words. */
const TEXT = "ui.fonts.text-medium";

/** The font of the game's count. */
const BOLD = "ui.fonts.alt-bold";

/** Every character of the game cases. */
const GAME_CHARS = "140★ можнопотратить";

/**
 * A mono font of the game cases.
 *
 * @param lineHeight - The line of the font at 32 px.
 * @param base - Its baseline at 32 px.
 * @param advance - The advance of every glyph at 32 px.
 * @returns The `.fnt` in BMFont JSON.
 */
function monoFont(lineHeight: number, base: number, advance: number): string {
  const chars = [...new Set(GAME_CHARS)].map(char => ({ char, xadvance: advance }));

  return JSON.stringify({ info: { size: 32 }, common: { lineHeight, base }, chars });
}

/**
 * A mono font of the game cases at an export size of its own.
 *
 * @param size - The export size.
 * @param lineHeight - The line of the font at that size.
 * @param base - Its baseline at that size.
 * @param advance - The advance of every glyph at that size.
 * @returns The `.fnt` in BMFont JSON.
 */
function sizedFont(size: number, lineHeight: number, base: number, advance: number): string {
  const chars = [...new Set(GAME_CHARS)].map(char => ({ char, xadvance: advance }));

  return JSON.stringify({ info: { size }, common: { lineHeight, base }, chars });
}

/** The two fonts of the game cases. */
function gameTables(): Map<string, AdvanceTable> {
  return new Map([
    [TEXT, parseAdvances(monoFont(48, 24, 16), TEXT)],
    [BOLD, parseAdvances(monoFont(36, 32, 20), BOLD)]
  ]);
}

/** The game's row style: 13 px words that wrap at their box. */
const row: TextStyle = style({ font: TEXT, size: 13, wrap: "box" });

/** The style a span of the count borrows: 16 px alt-bold. */
const amount: TextStyle = style({ font: BOLD, size: 16 });

/**
 * The options of a layout with the style table and the bold looks of the cases.
 *
 * @param looks - The bold looks, by the style they belong to.
 * @returns The options, the warnings collected.
 */
function looked(looks = new Map<TextStyle, TextStyle>()): LayoutOptions & { written: string[] } {
  const styles = new Map([
    ["album.row.13", row],
    ["album.row.amount.16", amount]
  ]);

  return { ...options(), styles, looks };
}

describe("layoutRuns — a line of pieces of two looks (F152)", () => {
  // The bug: the line is as high as the paragraph's line, the count of the larger font sticks out
  // of it, or the baseline is the top of the tallest piece and the words hang off it.
  it("builds line 0 by the line box of both looks, line 1 at the paragraph's line, the block their sum", () => {
    const runs = [text("140★", { span: "album.row.amount.16" }), text(" можно потратить")];
    const layout = layoutRuns(runs, row, gameTables(), looked(), 100);

    expect(layout.lines.map(line => line.width)).toEqual([79, 58.5]);
    // Baseline: the count's 16 over the words' 9.75. Height: 16 + the words' 9.75 below it.
    expect(layout.lines.map(line => [line.baseline, line.height])).toEqual([
      [16, 25.75],
      [9.75, 19.5]
    ]);
    expect(layout.height).toBe(45.25);
    expect(layout.width).toBe(79);
  });

  // The bug: the bold look is not read, so the count measures and stands as 13 px words.
  it("measures and boxes a <b> run of a style with boldStyle in its merged look", () => {
    const counted = { ...row, boldStyle: { font: BOLD, size: 16 } };
    const looks = new Map([[counted, boldLookOf(counted, { font: BOLD, size: 16 })]]);
    const runs = [text("140★", { bold: true }), text(" можно потратить")];
    const layout = layoutRuns(runs, counted, gameTables(), looked(looks), 100);

    // The count is drawn in alt-bold, 10 a glyph, and stands by alt-bold's metrics at 16 px: a
    // line of 18 with the baseline at 16, as the span of the same font does.
    expect(layout.lines.map(line => line.width)).toEqual([79, 58.5]);
    expect(layout.lines.map(line => [line.baseline, line.height])).toEqual([
      [16, 25.75],
      [9.75, 19.5]
    ]);
    expect(layout.height).toBe(45.25);
  });

  // The bug (existing content moves): a plain <b> in the style's bold font stands by that font,
  // so a game label of `bold:` + `<b>` changes height and its words move. Fonts shaped as the
  // shipped font-body (44 / 55 / 41) and alt-bold (48 / 59 / 46).
  it("keeps a plain <b> in a bold font of other ratios at the paragraph's line, as before F152", () => {
    const shaped = new Map([
      [TEXT, parseAdvances(sizedFont(44, 55, 41, 22), TEXT)],
      [BOLD, parseAdvances(sizedFont(48, 59, 46, 24), BOLD)]
    ]);
    const bolded = style({ font: TEXT, bold: BOLD, size: 13 });
    const runs = [text("140", { bold: true }), text(" можно\n"), text("140", { bold: true })];
    const layout = layoutRuns(runs, bolded, shaped, options());
    // Before F152: every line the regular font's line at 13 px, the glyphs at its top.
    const line = 55 * (13 / 44);

    expect(layout.lines.map(each => [each.baseline, each.height])).toEqual([
      [41 * (13 / 44), line],
      [41 * (13 / 44), line]
    ]);
    expect(layout.height).toBe(2 * line);
  });

  // The bug: a line of a smaller span is as short as the span, and the label shrinks under the
  // paragraph's line; a line of a larger span loses the paragraph's depth below the baseline.
  it("keeps the paragraph's line in every line as a strut", () => {
    const small = style({ font: TEXT, size: 8 });
    const options = {
      ...looked(),
      styles: new Map([
        ["small", small],
        ["album.row.amount.16", amount]
      ])
    };
    const smaller = layoutRuns([text("1", { span: "small" })], row, gameTables(), options);
    const larger = layoutRuns(
      [text("1", { span: "album.row.amount.16" })],
      row,
      gameTables(),
      options
    );

    // The strut: 9.75 above the baseline, 9.75 below. The small span: 6 above, 6 below.
    expect(smaller.lines.map(each => [each.baseline, each.height])).toEqual([[9.75, 19.5]]);
    // The larger span: 16 above, 2 below; the strut's 9.75 below wins.
    expect(larger.lines.map(each => [each.baseline, each.height])).toEqual([[16, 25.75]]);
  });

  // The bug: a block of one look sums its lines and drifts from `count × line` by a rounding.
  it("keeps a block of one look exactly as high as its lines times its line", () => {
    const plate = style({ size: 14, lineHeight: 1.28 });
    // Ten lines of 17.92 summed are 179.20000000000005; ten times one is 179.20000000000002.
    const ten = Array.from({ length: 10 }, () => "A").join("\n");
    const layout = layoutRuns([text(ten)], plate, tables(), options());

    expect(layout.height).toBe(10 * lineHeightOf(plate, tables()));
    expect(layout.lines.map(line => line.height)).toEqual(
      Array.from({ length: 10 }, () => lineHeightOf(plate, tables()))
    );
  });

  // The bug: a word whose two halves are of two looks breaks between them like two words.
  it("wraps a word made of runs of two looks as one word", () => {
    const big = style({ size: 64 });
    const options = { ...looked(), styles: new Map([["big", big]]) };
    const layout = layoutRuns(
      [text("A A"), text("A", { span: "big" })],
      style({ wrap: 90 }),
      tables(),
      options
    );

    expect(layout.lines.map(line => line.runs)).toEqual([
      [text("A")],
      [text("A"), text("A", { span: "big" })]
    ]);
    expect(layout.lines.map(line => line.width)).toEqual([24, 72]);
  });

  // The bug: the balance search measures the span at the paragraph's look and evens nothing.
  it("balances a block with a run of another look by the widths of its looks", () => {
    const wide = style({ size: 64 });
    const options = { ...looked(), styles: new Map([["wide", wide]]) };
    const runs = [text("AA BB "), text("CC", { span: "wide" }), text(" AA")];
    const layout = layoutRuns(runs, style({ wrap: 120, balance: true }), monoTables(), options);

    expect(layout.lines.map(line => line.width)).toEqual([50, 70]);
  });

  // The bug: a span of a key no table holds throws, or draws as nothing.
  it("lays a span of an unknown key out in the paragraph's look", () => {
    const runs = [text("A1", { span: "nope" })];

    expect(layoutRuns(runs, style(), tables(), looked()).width).toBe(
      layoutRuns([text("A1")], style(), tables(), options()).width
    );
  });

  // The bug: the line is the paragraph's, so a span with a line of its own does not move it.
  it("gives a piece whose style names its line that line, centred on the baseline", () => {
    const tall = style({ font: TEXT, size: 13, lineHeight: 2 });
    const options = { ...looked(), styles: new Map([["tall", tall]]) };
    const layout = layoutRuns([text("1", { span: "tall" }), text("1")], row, gameTables(), options);

    // The tall piece: a box of 26, half the leading (26 - 19.5) / 2 above its 9.75.
    expect(layout.lines.map(line => [line.baseline, line.height])).toEqual([[13, 26]]);
  });
});

/** The fixture body style with an indent. */
function indented(over: Partial<TextStyle> = {}): TextStyle {
  return style({ textIndent: 20, ...over });
}

describe("layoutRuns — textIndent (F152)", () => {
  // The bug: the indent is drawn but not measured, so ui gives the label a box 20 too narrow.
  it("counts the indent in the width of the first line and of the block", () => {
    const layout = layoutRuns([text("A A")], indented({ wrap: 200 }), tables(), options());

    expect(layout.lines.map(line => line.width)).toEqual([76]);
    expect(layout.width).toBe(76);
  });

  // The bug: the first line wraps at the whole wrap and its last word stands past the box.
  it("wraps the first line at the wrap less the indent, and the next lines at the wrap", () => {
    expect(
      layoutRuns([text("A A A")], style({ wrap: 100 }), tables(), options()).lines
    ).toHaveLength(1);
    expect(
      layoutRuns([text("A A A A A")], indented({ wrap: 100 }), tables(), options()).lines.map(
        line => line.width
      )
    ).toEqual([76, 88]);
  });

  // The bug: a first word wider than the room the indent leaves stands past the wrap.
  it("breaks a first word wider than the wrap less the indent between its glyphs", () => {
    const layout = layoutRuns([text("AAA")], indented({ wrap: 80 }), tables(), options());

    expect(layout.lines.map(line => line.width)).toEqual([68, 24]);
  });

  // The bug: every paragraph after a line break is indented again.
  it("indents the first line of the block only, not a line after a line break", () => {
    expect(
      layoutRuns([text("A\nA")], indented(), tables(), options()).lines.map(line => line.width)
    ).toEqual([44, 24]);
    expect(
      layoutRuns([text("A\nA A")], indented({ wrap: 200 }), tables(), options()).lines.map(
        line => line.width
      )
    ).toEqual([44, 56]);
  });

  // The bug: a block of one line per segment ignores the indent.
  it('shifts and widens the first line of a style with wrap "none"', () => {
    expect(layoutRuns([text("A")], indented(), tables(), options()).width).toBe(44);
  });

  // The bug: balance searches below the first word plus the indent and breaks the first word
  // between its glyphs, though it fits the wrap.
  it("never splits a first word that fits the wrap with the indent, when it balances", () => {
    const layout = layoutRuns(
      [text("AAAAA BB")],
      style({ wrap: 100, balance: true, textIndent: 45 }),
      monoTables(),
      options()
    );

    expect(
      layout.lines.map(line => line.runs.map(run => (run.kind === "text" ? run.text : "")))
    ).toEqual([["AAAAA"], ["BB"]]);
    expect(layout.lines.map(line => line.width)).toEqual([95, 20]);
  });

  // The bug: the bound of the first word counts the indent for a word on the line after a break,
  // where no indent is, and the block keeps its greedy lines.
  it("balances a block that starts with a line break as if it had no indent", () => {
    const layout = layoutRuns(
      [text("\nAA BB CC AA")],
      style({ wrap: 80, balance: true, textIndent: 70 }),
      monoTables(),
      options()
    );

    expect(
      layout.lines.map(line => line.runs.map(run => (run.kind === "text" ? run.text : "")).join(""))
    ).toEqual(["", "AA BB", "CC AA"]);
  });

  // The bug: balance ignores the indent and evens the lines as if the first one had the room.
  it("evens a block with an indent at the narrowest width that keeps its lines", () => {
    const layout = layoutRuns(
      [text("AA BB CC AA")],
      style({ wrap: 100, balance: true, textIndent: 30 }),
      monoTables(),
      options()
    );

    // Greedy: "AA BB" (30 + 50) / "CC AA"; at 80 the same two lines, narrower they are three.
    expect(layout.lines.map(line => line.width)).toEqual([80, 50]);
  });
});
