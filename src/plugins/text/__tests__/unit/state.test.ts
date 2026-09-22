import { describe, expect, it } from "vitest";
import { createTextState } from "../../state";

// ---------------------------------------------------------------------------
// The state starts empty: `onStart` fills the style table and the font keys,
// and the frame step fills everything else.
// ---------------------------------------------------------------------------

describe("createTextState", () => {
  it("starts with no style, no font and no label", () => {
    const state = createTextState();

    expect(state.styles.size).toBe(0);
    expect(state.styleOwner.size).toBe(0);
    expect(state.fontKeys.size).toBe(0);
    expect(state.tables.size).toBe(0);
    expect(state.installed.size).toBe(0);
    expect(state.seen.size).toBe(0);
    expect(state.bindTypes.size).toBe(0);
    expect(state.measured.size).toBe(0);
    expect(state.cache.size).toBe(0);
    expect(state.dirty.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.removers).toEqual([]);
  });

  it("hands every app its own collections", () => {
    const first = createTextState();
    const second = createTextState();

    first.dirty.add(1);

    expect(second.dirty.size).toBe(0);
    expect(second.styles).not.toBe(first.styles);
  });
});
