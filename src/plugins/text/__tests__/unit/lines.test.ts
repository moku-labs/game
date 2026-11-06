import { describe, expect, it } from "vitest";
import { boldLookOf } from "../../components";
import { ascentOf, lookOf, metricsFontOf } from "../../lines";
import { parseAdvances } from "../../measure";
import type { Run, TextRun, TextStyle } from "../../types";

// ---------------------------------------------------------------------------
// The line box (F152): which look a run is in, and which font it stands by.
// Pure: styles and runs in, a stored object or a font key out.
// ---------------------------------------------------------------------------

/** A stored style with the defaults of `body`; a case overrides what it is about. */
function style(over: Partial<TextStyle> = {}): TextStyle {
  return {
    font: "ui.font-body",
    bold: undefined,
    italic: undefined,
    size: 13,
    fill: 0,
    stroke: 0,
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

/** One glyph run with the flags a case is about. */
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

/** The game's row: 13 px words in a regular font with a bold one. */
const row = style({ font: "ui.fonts.text-medium", bold: "ui.fonts.text-bold" });

/** The style a span of the count borrows: 16 px alt-bold, with an italic font. */
const amount = style({ font: "ui.fonts.alt-bold", italic: "ui.fonts.alt-italic", size: 16 });

describe("lookOf (F152)", () => {
  /** A style with a bold look, and the look. */
  const counted = { ...row, boldStyle: { size: 16 } };
  const bold = boldLookOf(counted, { size: 16 });
  const styles = new Map([
    ["album.row.amount.16", amount],
    ["counted", counted]
  ]);
  const looks = new Map([[counted, bold]]);

  // The bug: a look is built per run, or the span loses to the paragraph, or `<b>` of a span takes
  // the paragraph's bold look.
  it("answers one of the stored objects: the paragraph, its bold look, a span's style or its bold look", () => {
    const icon: Run = { kind: "icon", key: "hud.coin", span: "album.row.amount.16" };

    expect(lookOf(counted, text("a"), styles, looks)).toBe(counted);
    expect(lookOf(counted, text("a", { bold: true }), styles, looks)).toBe(bold);
    expect(lookOf(row, text("a", { span: "album.row.amount.16", bold: true }), styles, looks)).toBe(
      amount
    );
    expect(lookOf(row, text("a", { span: "counted", bold: true }), styles, looks)).toBe(bold);
    expect(lookOf(row, text("a", { span: "nope" }), styles, looks)).toBe(row);
    expect(lookOf(row, icon, styles, looks)).toBe(amount);
  });
});

describe("metricsFontOf (F152)", () => {
  // The bug: a plain <b> stands by the bold font, so a label of `bold:` + `<b>` moves.
  it("keeps the paragraph's font for a plain <b> and <i> in the paragraph's look", () => {
    expect(metricsFontOf(row, row, text("1", { bold: true }))).toBe("ui.fonts.text-medium");
    expect(metricsFontOf(row, row, text("1", { italic: true }))).toBe("ui.fonts.text-medium");
  });

  // The bug: a run in a look of its own stands by the look's regular font, off the baseline of
  // the font Pixi draws it with.
  it("answers the drawn font for a run in a look of its own, and the look's font for an icon", () => {
    const counted = { ...row, boldStyle: { font: "ui.fonts.alt-bold" } };
    const bold = boldLookOf(counted, { font: "ui.fonts.alt-bold" });

    expect(metricsFontOf(counted, bold, text("1", { bold: true }))).toBe("ui.fonts.alt-bold");
    expect(metricsFontOf(row, amount, text("1", { italic: true, span: "a" }))).toBe(
      "ui.fonts.alt-italic"
    );
    expect(metricsFontOf(row, amount, { kind: "icon", key: "hud.coin", span: "a" })).toBe(
      "ui.fonts.alt-bold"
    );
  });
});

describe("ascentOf (F152)", () => {
  // The bug: the baseline is taken from the regular font whatever font is named, or the fallback
  // is not 0.8 em.
  it("reads the base of the named font at the style size, 0.8 em while it is not loaded", () => {
    const fnt = '{"info":{"size":48},"common":{"lineHeight":59,"base":46},"chars":[]}';
    const tables = new Map([["ui.fonts.alt-bold", parseAdvances(fnt, "ui.fonts.alt-bold")]]);

    expect(ascentOf(style({ size: 24 }), tables, "ui.fonts.alt-bold")).toBe(23);
    expect(ascentOf(style({ size: 20 }), tables)).toBe(16);
  });
});
