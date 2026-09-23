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

// ─── delta 4: hover, covered and the visual transform styles ──

describe("the state variants of delta 4", () => {
  const style = defineStyle({
    fill: 1,
    is: {
      disabled: { fill: 2, nineSlice: "ui.off" },
      active: { fill: 3 },
      selected: { fill: 4 },
      hover: { fill: 5, offsetY: -6 },
      pressed: { fill: 6, offsetY: 4 },
      covered: { fill: 7, scale: 0.84 }
    }
  });

  it("merges hover after selected and pressed after hover", () => {
    expect(resolve(style, flags({ selected: true, hover: true }), viewportOf()).fill).toBe(5);
    expect(resolve(style, flags({ hover: true, pressed: true }), viewportOf())).toMatchObject({
      fill: 6,
      offsetY: 4
    });
  });

  it("merges covered after pressed", () => {
    expect(resolve(style, flags({ pressed: true, covered: true }), viewportOf())).toMatchObject({
      fill: 7,
      offsetY: 4,
      scale: 0.84
    });
  });

  it("applies neither hover nor pressed while disabled", () => {
    const resolved = resolve(
      style,
      flags({ disabled: true, hover: true, pressed: true }),
      viewportOf()
    );

    expect(resolved.fill).toBe(2);
    expect(resolved.offsetY).toBeUndefined();
    expect(resolved.nineSlice).toBe("ui.off");
  });

  it("starts every element with the seven state flags off", () => {
    expect(noFlags()).toEqual({
      pressed: false,
      hover: false,
      focus: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    });
  });
});

describe("the state variants of delta 6", () => {
  const style = defineStyle({
    gap: 0,
    is: { hover: { gap: 1 }, focus: { gap: 2, rotation: 0.1 }, pressed: { gap: 3 } }
  });

  it("merges focus after hover and before pressed", () => {
    expect(resolve(style, flags({ hover: true, focus: true }), viewportOf()).gap).toBe(2);
    expect(resolve(style, flags({ focus: true, pressed: true }), viewportOf()).gap).toBe(3);
  });

  it("takes rotation, zIndex, shape and dash like any other field, in a variant too", () => {
    const resolved = resolve(
      defineStyle({ rotation: -0.026, zIndex: 1, shape: "triangle", dash: 10 }),
      flags(),
      viewportOf()
    );

    expect(resolved).toMatchObject({ rotation: -0.026, zIndex: 1, shape: "triangle", dash: 10 });
    expect(resolve(style, flags({ focus: true }), viewportOf()).rotation).toBe(0.1);
  });
});

describe("the visual fields of delta 4", () => {
  it("resolve offset, scale, origin, tint, nine-slice and fit like any other field", () => {
    const style = defineStyle({
      offsetX: 4,
      offsetY: -8,
      scale: 1.1,
      origin: "top",
      tint: 0xff_00_00,
      nineSlice: "ui.panel",
      fit: "contain",
      when: { tall: { origin: { x: 0.5, y: 1 } } }
    });

    expect(resolve(style, flags(), viewportOf())).toEqual({
      offsetX: 4,
      offsetY: -8,
      scale: 1.1,
      origin: "top",
      tint: 0xff_00_00,
      nineSlice: "ui.panel",
      fit: "contain"
    });
    expect(resolve(style, flags({ tall: true }), viewportOf()).origin).toEqual({ x: 0.5, y: 1 });
  });
});
