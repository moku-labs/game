import { describe, expect, it } from "vitest";
import {
  caretIndexOf,
  type FieldLayoutInput,
  insetOf,
  layoutField,
  liftOf,
  paddingOf,
  shiftOf
} from "../../jsx/field-layout";

// ---------------------------------------------------------------------------
// Unit test: where the parts of a text field go — pure, from the mirror, the
// measured prefixes (10 px per character here) and the field's box
// ---------------------------------------------------------------------------

/** A field 300 x 100 with 20 of padding, a 40 px line, a 3 px caret and a 3 px underline. */
function inputOf(patch: Partial<FieldLayoutInput>): FieldLayoutInput {
  return {
    value: "Alex",
    mirror: { value: "Alex", selectionStart: 4, selectionEnd: 4, direction: "none" },
    composing: undefined,
    size: { w: 300, h: 100 },
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    lineHeight: 40,
    caretWidth: 3,
    underline: 3,
    prefix: text => text.length * 10,
    hasGlyph: () => true,
    ...patch
  };
}

describe("paddingOf", () => {
  it("reads one number for every edge, and the edges a style names", () => {
    expect(paddingOf(20)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(paddingOf({ left: 8, top: 4 })).toEqual({ top: 4, right: 0, bottom: 0, left: 8 });
    expect(paddingOf(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("caretIndexOf", () => {
  it("stands at the end a selection was made towards, and at its end while composing", () => {
    const backward = {
      value: "Alex",
      selectionStart: 1,
      selectionEnd: 3,
      direction: "backward"
    } as const;

    expect(caretIndexOf(backward, false)).toBe(1);
    expect(caretIndexOf({ ...backward, direction: "forward" }, false)).toBe(3);
    expect(caretIndexOf(backward, true)).toBe(3);
  });
});

describe("shiftOf", () => {
  it("scrolls the text left only as far as the caret needs", () => {
    expect(shiftOf(120, 260)).toBe(0);
    expect(shiftOf(300, 260)).toBe(40);
  });
});

describe("layoutField", () => {
  it("puts the caret after the measured prefix, centred on the line", () => {
    const layout = layoutField(
      inputOf({ mirror: { value: "Alex", selectionStart: 2, selectionEnd: 2, direction: "none" } })
    );

    expect(layout.caret).toEqual({ x: 40, y: 30, w: 3, h: 40, shown: true });
    expect(layout.text).toEqual({ x: 20, y: 30 });
    expect(layout.content).toBe("value");
    expect(layout.selection.shown).toBe(false);
  });

  it("draws the selection from one prefix to the other, both ways", () => {
    const forward = layoutField(
      inputOf({
        mirror: { value: "Alex", selectionStart: 1, selectionEnd: 3, direction: "forward" }
      })
    );
    const backward = layoutField(
      inputOf({
        mirror: { value: "Alex", selectionStart: 1, selectionEnd: 3, direction: "backward" }
      })
    );

    expect(forward.selection).toEqual({ x: 30, y: 30, w: 20, h: 40, shown: true });
    expect(forward.caret.x).toBe(50);
    expect(backward.selection).toEqual(forward.selection);
    expect(backward.caret.x).toBe(30);
  });

  it("draws no selection while composing, and underlines the composing range", () => {
    const layout = layoutField(
      inputOf({
        mirror: { value: "Alex", selectionStart: 1, selectionEnd: 3, direction: "none" },
        composing: { start: 1, end: 3 }
      })
    );

    expect(layout.selection.shown).toBe(false);
    expect(layout.caret.x).toBe(50);
    expect(layout.composing).toEqual({ x: 30, y: 67, w: 20, h: 3, shown: true });
  });

  it("scrolls a value wider than the box so the caret stays inside", () => {
    const value = "abcdefghijklmnopqrstuvwxyz0123";
    const layout = layoutField(
      inputOf({
        value,
        mirror: { value, selectionStart: 30, selectionEnd: 30, direction: "none" }
      })
    );

    expect(layout.text.x).toBe(-20);
    expect(layout.caret.x).toBe(280);
  });

  it("ends the caret at the drawn text when the font has no glyph for a character", () => {
    const value = "ab😀";
    const layout = layoutField(
      inputOf({
        value,
        mirror: { value, selectionStart: 4, selectionEnd: 4, direction: "none" },
        hasGlyph: char => char !== "😀"
      })
    );

    // Pixi draws nothing for the emoji, so the caret stands right after "ab": 20 + 2 × 10.
    expect(layout.caret.x).toBe(40);
  });

  it("selects across a character with no glyph by the drawn width only", () => {
    const value = "a😀b";
    const layout = layoutField(
      inputOf({
        value,
        mirror: { value, selectionStart: 0, selectionEnd: 4, direction: "forward" },
        hasGlyph: char => char !== "😀"
      })
    );

    expect(layout.selection).toEqual({ x: 20, y: 30, w: 20, h: 40, shown: true });
    expect(layout.caret.x).toBe(40);
  });

  it("shows the placeholder while the value is empty, and no caret outside the editing", () => {
    const layout = layoutField(inputOf({ value: "", mirror: undefined }));

    expect(layout.content).toBe("placeholder");
    expect(layout.caret.shown).toBe(false);
    expect(layout.selection.shown).toBe(false);
    expect(layout.composing.shown).toBe(false);
    expect(layout.text).toEqual({ x: 20, y: 30 });
  });
});

describe("the keyboard lift", () => {
  it("lifts the field above the keyboard with P12's numbers, and not at all when it is down", () => {
    const inset = insetOf({ innerHeight: 714, offsetTop: 0, height: 404 });

    expect(inset).toBe(310);
    // 540 + 16 − (714 − 310): the field bottom plus the margin, over what the keyboard leaves.
    expect(liftOf({ fieldBottom: 540, margin: 16, innerHeight: 714, inset })).toBe(152);
    expect(
      liftOf({
        fieldBottom: 540,
        margin: 16,
        innerHeight: 714,
        inset: insetOf({ innerHeight: 714, offsetTop: 0, height: 714 })
      })
    ).toBe(0);
  });
});
