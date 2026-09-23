import { describe, expect, it } from "vitest";
import { layoutRuns, measureRun, parseAdvances } from "../../measure";
import type { AdvanceTable, LayoutOptions, TextRun, TextStyle, Warn } from "../../types";
import { miniFontJson, miniFontNoMissing, miniFontXml } from "../fixtures/mini-font";

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
    ...over
  };
}

/** The fixture tables, under the font keys a style may name. */
function tables(fnt: string = miniFontJson): Map<string, AdvanceTable> {
  return new Map([["ui.font-body", parseAdvances(fnt, "ui.font-body")]]);
}

/** One plain run of glyphs. */
function text(value: string, over: Partial<TextRun> = {}): TextRun {
  return { kind: "text", text: value, bold: false, italic: false, color: undefined, ...over };
}

/** The options a layout takes, with the warnings collected. */
function options(): LayoutOptions & { written: string[] } {
  const written: string[] = [];
  const warn: Warn = (key): void => {
    written.push(key);
  };

  return { missingGlyph: "□", warn, written };
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

    expect(layout).toEqual({ lines: [{ runs: [text("12")], width: 36 }], width: 36, height: 40 });
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

  it("gives a character the font lacks the advance of the missing glyph", () => {
    const written = options();
    const layout = layoutRuns([text("1Z")], style(), tables(), written);

    expect(layout.width).toBe(28);
    expect(written.written).toEqual(["glyph:ui.font-body:Z"]);
  });

  it("falls back to 0.6 em when the font has no missing glyph either", () => {
    const layout = layoutRuns([text("1Z")], style(), tables(miniFontNoMissing), options());

    expect(layout.width).toBeCloseTo(35.2, 5);
  });

  it("makes an icon run as wide as the line is high", () => {
    const layout = layoutRuns([{ kind: "icon", key: "hud.coin" }], style(), tables(), options());

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

  it("drops an icon inside a wrapped style and warns", () => {
    const written = options();
    const layout = layoutRuns(
      [text("A"), { kind: "icon", key: "hud.coin" }],
      style({ wrap: 200 }),
      tables(),
      written
    );

    expect(layout.lines[0]?.runs).toEqual([text("A")]);
    expect(written.written).toEqual(["icon-wrapped:hud.coin"]);
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

describe("layoutRuns — the headless fallback", () => {
  it("advances 0.6 em per glyph and 1.2 em per line, and names the font once", () => {
    const written = options();
    const layout = layoutRuns([text("12"), text("A")], style(), new Map(), written);

    expect(layout.width).toBeCloseTo(57.6, 5);
    expect(layout.height).toBeCloseTo(38.4, 5);
    expect(written.written).toEqual(["font:ui.font-body"]);
  });
});
