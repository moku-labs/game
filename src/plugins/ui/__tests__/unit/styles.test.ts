import { describe, expect, it } from "vitest";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { createStylesApi } from "../../styles/api";
import { defineStyle } from "../../styles/define";
import { flagsOf, noFlags, sameViewport } from "../../styles/flags";
import { resolve, type StyleFlags } from "../../styles/resolve";
import { createStylesState } from "../../styles/state";
import { defineTokens } from "../../styles/tokens";
import type { Style, TextTagStyle } from "../../styles/types";
import type { UiCtx } from "../../types";

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

  it("freezes the padding and the margin of the base and of every variant", () => {
    // Bug caught: the edges of a defined style stay writable, so the resolution, which hands them out as they are,
    // shares a writable object with every element of the style.
    const style = defineStyle({
      padding: { top: 4 },
      margin: { left: 2 },
      when: { landscape: { padding: { top: 8 } } },
      is: { pressed: { margin: { left: 6 } } }
    });

    expect(Object.isFrozen(style.padding)).toBe(true);
    expect(Object.isFrozen(style.margin)).toBe(true);
    expect(Object.isFrozen(style.when?.landscape?.padding)).toBe(true);
    expect(Object.isFrozen(style.is?.pressed?.margin)).toBe(true);
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

// ─── the viewport of a frame ──────────────────────────────────

/**
 * Builds the styles module over a fresh state, with the default breakpoints.
 *
 * @returns The module and its state.
 */
function stylesModule() {
  const state = createStylesState();
  const ctx = {
    config: { breakpoints: { tall: 2, wide: 1.5 } },
    state: { styles: state }
  } as unknown as UiCtx;

  return { styles: createStylesApi(ctx), state };
}

describe("useViewport: the viewport of a frame", () => {
  it("builds no new flags for the same viewport object", () => {
    const { styles, state } = stylesModule();
    const frame = Object.freeze(viewportOf());

    styles.useViewport(frame);

    const built = state.flags;

    expect(styles.useViewport(frame)).toBe(false);
    expect(state.flags).toBe(built);
  });

  it("answers unchanged for a new object with equal numbers, and changed for another size", () => {
    const { styles } = stylesModule();

    styles.useViewport(viewportOf());

    expect(styles.useViewport(viewportOf())).toBe(false);
    expect(styles.useViewport(viewportOf({ height: 2400 }))).toBe(true);
  });
});

describe("resolveElement: the resolution kept per style object (F244 В)", () => {
  /** The state flags of an element no pointer touches. */
  const IDLE = noFlags();

  it("hands out the kept resolution for the same style, flags and viewport, and resolves again for other flags", () => {
    // Bug caught: a kept resolution handed out after the element was pressed, so the press shows nothing.
    const { styles } = stylesModule();
    const style = defineStyle({ gap: 8, is: { pressed: { gap: 4 } } });

    styles.useViewport(viewportOf());

    const first = styles.resolveElement(style, IDLE);

    expect(styles.resolveElement(style, IDLE)).toBe(first);
    expect(styles.resolveElement(style, { ...IDLE, pressed: true }).gap).toBe(4);
    expect(styles.resolveElement(style, IDLE).gap).toBe(8);
  });

  it("hands every element of one style the same object, and that object cannot be written", () => {
    // Bug caught: a write into a resolved style (an element's own field, a padding edge) would reach every element
    // that shares the style object and the state flags.
    const { styles } = stylesModule();
    const style = defineStyle({ gap: 8, padding: { top: 4, left: 2 } });

    styles.useViewport(viewportOf());

    const first = styles.resolveElement(style, IDLE);
    const second = styles.resolveElement(style, IDLE);
    const writeGap = (): void => {
      (first as { gap?: number }).gap = 99;
    };
    const writeEdge = (): void => {
      (first.padding as { top?: number }).top = 99;
    };

    expect(second).toBe(first);
    expect(writeGap).toThrow(TypeError);
    expect(writeEdge).toThrow(TypeError);
    expect(second.gap).toBe(8);
  });

  it("resolves a kept style again when the viewport changes its safe area or its size", () => {
    // Bug caught: a style kept across a new viewport keeps the old safe-area inset or the old `when` variant.
    const { styles } = stylesModule();
    const style = defineStyle({
      top: "safeArea.top",
      gap: 8,
      when: { landscape: { gap: 16 } }
    });

    styles.useViewport(viewportOf());
    expect(styles.resolveElement(style, IDLE).top).toBe(0);

    styles.useViewport(viewportOf({ safeArea: { top: 44, right: 0, bottom: 0, left: 0 } }));
    expect(styles.resolveElement(style, IDLE).top).toBe(44);

    styles.useViewport(viewportOf({ width: 1920, height: 1080, orientation: "landscape" }));
    expect(styles.resolveElement(style, IDLE).gap).toBe(16);
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

  it("answers a frozen copy of the edges a game wrote inline, and the frozen edges of a defined style as they are", () => {
    // Bug caught: the resolution hands out the game's own padding object, so a write into one element's padding
    // reaches the next resolve of that object; or copies the frozen edges of a defined style on every resolve.
    const inline = { top: 4, left: 2 };
    const resolved = resolve({ padding: inline, margin: 6 }, flags(), viewportOf());
    const defined = defineStyle({ padding: { top: 4 }, is: { active: { margin: { left: 8 } } } });
    const active = resolve(defined, flags({ active: true }), viewportOf());

    expect(resolved.padding).toEqual({ top: 4, left: 2 });
    expect(resolved.padding).not.toBe(inline);
    expect(Object.isFrozen(resolved.padding)).toBe(true);
    expect(Object.isFrozen(inline)).toBe(false);
    expect(resolved.margin).toBe(6);
    expect(active.padding).toBe(defined.padding);
    expect(active.margin).toBe(defined.is?.active?.margin);
  });

  it("drops a field the style holds as undefined, in the base and in a variant", () => {
    // Bug caught: an `undefined` in a variant overwrites the base value, or a key with `undefined` reaches the layout.
    const resolved = resolve(
      // A JS game, or a spread of an optional value, can hand a field over as `undefined`.
      { gap: 8, width: undefined, is: { active: { gap: undefined } } } as unknown as Style,
      flags({ active: true }),
      viewportOf()
    );

    expect(resolved).toEqual({ gap: 8 });
    expect(Object.keys(resolved)).toEqual(["gap"]);
  });

  it("answers an empty style for an element that wrote none", () => {
    expect(resolve(undefined, flags(), viewportOf())).toEqual({});
  });

  it("keeps the text style key of the base while a plain object carries one in an is variant", () => {
    // `is` has no `text` in its type, but a style object that is not a literal may still carry it:
    // a press must not change the letters.
    const pressedWithText = { gap: 4, text: "title.99" };
    const style: TextTagStyle = { text: "title.19", is: { pressed: pressedWithText } };
    const resolved = resolve(style, flags({ pressed: true }), viewportOf());

    expect(resolved.gap).toBe(4);
    expect(resolved.text).toBe("title.19");
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
