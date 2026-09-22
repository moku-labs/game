import { describe, expect, it } from "vitest";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { defineStyle } from "../../styles/define";
import { flagsOf, noFlags, sameViewport } from "../../styles/flags";
import { resolve, type StyleFlags } from "../../styles/resolve";
import { defineTokens } from "../../styles/tokens";

/**
 * Builds a viewport for a test.
 *
 * @param patch - What to change about the portrait default.
 * @returns The viewport.
 */
function viewportOf(patch: Partial<ViewportSize> = {}): ViewportSize {
  return {
    width: 1080,
    height: 1920,
    scale: 1,
    orientation: "portrait",
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    ...patch
  };
}

/**
 * Builds the eight flags a resolve runs against.
 *
 * @param patch - The flags that are true.
 * @returns The flags.
 */
function flags(patch: Partial<StyleFlags> = {}): StyleFlags {
  return { portrait: true, landscape: false, tall: false, wide: false, ...noFlags(), ...patch };
}

// ─── define ───────────────────────────────────────────────────

describe("defineStyle and defineTokens", () => {
  it("return the same object, frozen", () => {
    const style = defineStyle({ direction: "row", gap: 12 });

    expect(Object.isFrozen(style)).toBe(true);
    expect(style.gap).toBe(12);
  });

  it("keep the token table flat and readable by key", () => {
    const tokens = defineTokens({ space: { md: 16 }, color: { panel: 0x10_10_18 } });

    expect(tokens.space.md).toBe(16);
    expect(Object.isFrozen(tokens)).toBe(true);
  });
});

// ─── flags ────────────────────────────────────────────────────

describe("when flags", () => {
  it("reads portrait and landscape from the orientation", () => {
    expect(flagsOf(viewportOf(), { tall: 2, wide: 1.5 }).portrait).toBe(true);
    expect(
      flagsOf(viewportOf({ orientation: "landscape" }), { tall: 2, wide: 1.5 }).landscape
    ).toBe(true);
  });

  it("is tall on a 20:9 phone and wide on a landscape tablet", () => {
    expect(flagsOf(viewportOf({ width: 1080, height: 2400 }), { tall: 2, wide: 1.5 }).tall).toBe(
      true
    );
    expect(flagsOf(viewportOf({ width: 1620, height: 1080 }), { tall: 2, wide: 1.5 }).wide).toBe(
      true
    );
  });

  it("tells a viewport that changed from one that did not", () => {
    expect(sameViewport(viewportOf(), viewportOf())).toBe(true);
    expect(sameViewport(viewportOf(), viewportOf({ width: 720 }))).toBe(false);
    expect(sameViewport(undefined, viewportOf())).toBe(false);
  });
});

// ─── resolve ──────────────────────────────────────────────────

describe("resolve", () => {
  it("lays the when variants over the base and the is variants over those", () => {
    const style = defineStyle({
      gap: 8,
      when: { landscape: { gap: 16 } },
      is: { pressed: { gap: 4 } }
    });

    expect(resolve(style, flags(), viewportOf()).gap).toBe(8);
    expect(resolve(style, flags({ landscape: true }), viewportOf()).gap).toBe(16);
    expect(resolve(style, flags({ landscape: true, pressed: true }), viewportOf()).gap).toBe(4);
  });

  it("replaces the safe-area tokens with the insets of the viewport", () => {
    const style = defineStyle({ padding: { top: "safeArea.top" }, top: "safeArea.bottom" });
    const resolved = resolve(
      style,
      flags(),
      viewportOf({ safeArea: { top: 44, right: 0, bottom: 34, left: 0 } })
    );

    expect(resolved.padding).toEqual({ top: 44 });
    expect(resolved.top).toBe(34);
  });

  it("never mutates the style it was given and freezes what it answers", () => {
    const style = defineStyle({ gap: 8, is: { active: { gap: 12 } } });
    const resolved = resolve(style, flags({ active: true }), viewportOf());

    expect(style.gap).toBe(8);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("answers an empty style for an element that wrote none", () => {
    expect(resolve(undefined, flags(), viewportOf())).toEqual({});
  });
});
