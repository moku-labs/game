import { describe, expect, it } from "vitest";
import type { PixiTexture } from "../../../renderer/types";
import { msdfOpacity } from "../../alpha";
import { defineTextStyles, Text } from "../../components";
import type { TextStyle, TextStyles, TextValue } from "../../types";
import { miniFontJson, miniFontMsdfXml } from "../fixtures/mini-font";
import { createMockText, type FakeObject, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The display adapter, over a fake Pixi module: one BitmapText per text run,
// one Sprite per icon, and nothing at all while the renderer is inert.
// ---------------------------------------------------------------------------

/** A texture the fake `assets` answers an icon key with. */
const coinTexture = { label: "hud.coin" } as unknown as PixiTexture;

/** The styles a feature brings, so bold and italic have both paths. */
const styles: TextStyles = {
  kind: "textStyles",
  map: {
    "hud.rich": {
      font: "ui.font-body",
      bold: "ui.font-bold",
      italic: "ui.font-italic",
      size: 40,
      fill: 0xff_e0_82,
      stroke: 0x00_00_00,
      strokeWidth: 0,
      letterSpacing: 0,
      align: "left",
      wrap: "none",
      digits: false,
      shadow: undefined
    }
  }
};

/** The top left anchor, so a case reads the raw offsets. */
const zero = { x: 0, y: 0 };

/** A centred style with the defaults of `body`, registered by a case that needs it. */
const centred: TextStyle = {
  font: "ui.font-body",
  bold: undefined,
  italic: undefined,
  size: 32,
  fill: 0xff_ff_ff,
  stroke: 0x00_00_00,
  strokeWidth: 0,
  letterSpacing: 0,
  align: "center",
  wrap: "none",
  digits: false,
  shadow: undefined
};

/** A started plugin whose renderer draws. */
function drawing(): MockText {
  const mock = createMockText({
    features: [{ name: "hud", description: { textStyles: styles } }]
  });

  mock.renderer.ready = true;
  mock.assets.textures.set("hud.coin", coinTexture);
  mock.start();

  return mock;
}

/** One `Text` value with the fields a case is about. */
function value(over: Partial<TextValue> = {}): TextValue {
  return { ...Text.defaults, ...over };
}

/** Builds the display object of a value through the registered adapter. */
function build(mock: MockText, text: TextValue): FakeObject {
  const entry = mock.renderer.provided[0];

  if (entry === undefined) throw new Error("no adapter was registered");

  return entry.adapter.create(text, 1) as FakeObject;
}

/** The text a BitmapText shows. */
function textOf(object: FakeObject | undefined): unknown {
  return object?.text;
}

/** The Pixi style a BitmapText was built with. */
function styleOfObject(object: FakeObject | undefined): Record<string, unknown> {
  return object?.options.style as Record<string, unknown>;
}

/** A point rounded to four decimals, so offsets compare with `toEqual`. */
function rounded(x: number, y: number): { x: number; y: number } {
  // `+ 0` folds -0 into 0, which `toEqual` tells apart.
  return { x: Math.round(x * 10_000) / 10_000 + 0, y: Math.round(y * 10_000) / 10_000 + 0 };
}

/** The offsets of copies from the run they surround. */
function offsetsOf(
  copies: readonly FakeObject[],
  run: FakeObject | undefined
): Array<{ x: number; y: number }> {
  return copies.map(copy => rounded(copy.x - (run?.x ?? 0), copy.y - (run?.y ?? 0)));
}

/** Where `count` copies sit on a circle of `radius`, starting to the right, clockwise on screen. */
function ring(count: number, radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;

    return rounded(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

describe("the display adapter", () => {
  it("is registered for the Text component", () => {
    const mock = drawing();

    expect(mock.renderer.provided.map(entry => entry.component)).toEqual(["Text"]);
  });

  it("builds a container with one BitmapText per run", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "a<b>b</b>", style: "hud.rich" }));

    expect(object.kind).toBe("Container");
    expect(object.children.map(child => child.kind)).toEqual(["BitmapText", "BitmapText"]);
  });

  it("draws a bold run with the bold font the style names", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "<b>b</b>", style: "hud.rich" }));
    const style = object.children[0]?.options.style as Record<string, unknown>;

    expect(style.fontFamily).toBe("ui.font-bold");
    expect(style.stroke).toBeUndefined();
  });

  it("thickens a bold run with copies in the fill colour when the style names no bold font", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "<b>b</b>" }));
    const styles = object.children.map(child => styleOfObject(child));

    expect(object.children).toHaveLength(9);
    expect(styles.map(style => style.fontFamily)).toEqual(
      Array.from({ length: 9 }, () => "ui.font-body")
    );
    expect(styles.map(style => style.fill)).toEqual(Array.from({ length: 9 }, () => 0xff_ff_ff));
    expect(styles.map(style => style.stroke)).toEqual(Array.from({ length: 9 }, () => undefined));
    expect(offsetsOf(object.children.slice(0, 8), object.children[8])).toEqual(ring(8, 1.6));
  });

  it("skews an italic run when the style names no italic font", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "<i>i</i>" }));

    expect(object.children[0]?.skew.x).toBe(-0.2);
  });

  it("takes the colour of a coloured run over the fill of the style", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "<color=#ff0000>x</color>" }));
    const style = object.children[0]?.options.style as Record<string, unknown>;

    expect(style.fill).toBe(0xff_00_00);
  });

  it("draws an icon run as a sprite of the asset, square at the line height", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "<icon=hud.coin>" }));
    const sprite = object.children[0];

    expect(sprite?.kind).toBe("Sprite");
    expect(sprite?.texture).toBe(coinTexture);
    expect(sprite?.width).toBeCloseTo(38.4, 5);
    expect(sprite?.height).toBeCloseTo(38.4, 5);
  });

  it("anchors the block by the anchor of the component", () => {
    const mock = drawing();
    const topLeft = build(mock, value({ resolved: "12", anchor: { x: 0, y: 0 } }));
    const centred = build(mock, value({ resolved: "12", anchor: { x: 0.5, y: 0.5 } }));

    expect(topLeft.children[0]?.x).toBe(0);
    expect(centred.children[0]?.x).toBeCloseTo(-19.2, 5);
    expect(centred.children[0]?.y).toBeCloseTo(-19.2, 5);
  });

  it("places the short line of a centred style inside the widest one", () => {
    const mock = drawing();

    mock.state.styles.set("centred", centred);

    const object = build(mock, value({ resolved: "1\n12", style: "centred", anchor: zero }));

    expect(object.children[0]?.x).toBeCloseTo(9.6, 5);
    expect(object.children[1]?.x).toBe(0);
  });

  it("pushes the short line of a right aligned style to the end", () => {
    const mock = drawing();

    mock.state.styles.set("right", { ...centred, align: "right" });

    const object = build(mock, value({ resolved: "1\n12", style: "right", anchor: zero }));

    expect(object.children[0]?.x).toBeCloseTo(19.2, 5);
  });

  it("rebuilds on a changed resolved string whose runs changed", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12" }));
    const before = object.children[0];

    entry?.adapter.update(object, value({ resolved: "12" }), value({ resolved: "1<b>2</b>" }));

    expect(before?.destroyed).toBe(true);
    expect(object.children).toHaveLength(10);
    expect(object.children[0]).not.toBe(before);
  });

  it("rebuilds when a line is added, or the anchor or the style changed", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const cases: Array<[TextValue, TextValue]> = [
      [value({ resolved: "12" }), value({ resolved: "1\n2" })],
      [value({ resolved: "12" }), value({ resolved: "13", anchor: zero })],
      [value({ resolved: "12" }), value({ resolved: "13", style: "hud.rich" })],
      [value({ resolved: "<b>1</b>" }), value({ resolved: "2" })],
      [value({ resolved: "<i>1</i>" }), value({ resolved: "2" })],
      [value({ resolved: "<color=#ff0000>1</color>" }), value({ resolved: "2" })],
      [value({ resolved: "<icon=hud.coin>" }), value({ resolved: "<icon=hud.gem>" })],
      [value({ resolved: "<icon=hud.coin>" }), value({ resolved: "2" })]
    ];

    for (const [previous, next] of cases) {
      const object = build(mock, previous);
      const before = object.children[0];

      entry?.adapter.update(object, previous, next);

      expect(before?.destroyed).toBe(true);
    }
  });

  it("keeps the child objects on a counter tick and writes the new text in place", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "<icon=hud.coin>12<b>x</b>" }));
    const before = [...object.children];

    entry?.adapter.update(
      object,
      value({ resolved: "<icon=hud.coin>12<b>x</b>" }),
      value({ resolved: "<icon=hud.coin>13<b>y</b>" })
    );

    expect(object.children).toEqual(before);
    expect(object.children.every((child, index) => child === before[index])).toBe(true);
    expect(before.map(child => child.destroyed)).toEqual(before.map(() => false));
    // The icon, the digits, then the bold run: eight copies in the fill and the run.
    expect(object.children).toHaveLength(11);
    expect(object.children.slice(1).map(child => textOf(child))).toEqual([
      "13",
      ...Array.from({ length: 9 }, () => "y")
    ]);
    expect(object.children[0]?.texture).toBe(coinTexture);
  });

  it("moves the runs in place when the lines change width", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];

    mock.state.styles.set("centred", centred);

    const previous = value({ resolved: "1\n12", style: "centred", anchor: zero });
    const object = build(mock, previous);
    const [top, bottom] = object.children;

    entry?.adapter.update(
      object,
      previous,
      value({ resolved: "12\n1", style: "centred", anchor: zero })
    );

    expect(object.children).toHaveLength(2);
    expect(object.children[0]).toBe(top);
    expect(object.children[1]).toBe(bottom);
    expect(top?.x).toBe(0);
    expect(bottom?.x).toBeCloseTo(9.6, 5);
    expect(bottom?.y).toBeCloseTo(38.4, 5);
    expect([textOf(top), textOf(bottom)]).toEqual(["12", "1"]);
  });

  it("does nothing when the value that matters did not change", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12" }));
    const before = object.children[0];

    entry?.adapter.update(object, value({ resolved: "12" }), value({ resolved: "12" }));

    expect(object.children[0]).toBe(before);
  });

  it("frees its children and keeps the textures of assets", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12" }));

    entry?.adapter.destroy(object);

    expect(object.destroyed).toBe(true);
    expect(object.destroyOptions).toEqual({ children: true, texture: false });
  });
});

describe("the shadow of a style", () => {
  /** The shadow of `hud.title`; `hud.solid` has the same one with the alpha left out. */
  const shadow = { color: 0x5b_3a_1e, dx: 2, dy: 4, alpha: 0.5 };

  /** A started plugin whose renderer draws, with a shadowed style, its twin, and a solid one. */
  function shadowed(): MockText {
    const mock = createMockText({
      features: [
        {
          name: "popup",
          description: {
            textStyles: defineTextStyles({
              "hud.title": { font: "ui.font-body", size: 32, fill: 0xff_f3_d6, shadow },
              "hud.plain": { font: "ui.font-body", size: 32, fill: 0xff_f3_d6 },
              "hud.solid": {
                font: "ui.font-body",
                size: 32,
                fill: 0xff_f3_d6,
                shadow: { color: 0, dx: 0, dy: 3 }
              }
            })
          }
        }
      ]
    });

    mock.renderer.ready = true;
    mock.assets.textures.set("hud.coin", coinTexture);
    mock.start();

    return mock;
  }

  it("draws two BitmapText objects per run, the shadow first", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "a<i>b</i>", style: "hud.title" }));

    expect(object.children.map(child => child.kind)).toEqual([
      "BitmapText",
      "BitmapText",
      "BitmapText",
      "BitmapText"
    ]);
    expect(object.children.map(child => textOf(child))).toEqual(["a", "a", "b", "b"]);
    expect(object.children.map(child => child.tint)).toEqual([
      0x5b_3a_1e, 0xff_ff_ff, 0x5b_3a_1e, 0xff_ff_ff
    ]);
  });

  it("draws one BitmapText per run for a style with no shadow", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "a<i>b</i>", style: "hud.plain" }));

    expect(object.children.map(child => textOf(child))).toEqual(["a", "b"]);
  });

  it("moves the shadow by dx and dy from the run", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "12", style: "hud.title" }));
    const [under, over] = object.children;

    expect(under?.x).toBeCloseTo((over?.x ?? 0) + 2, 5);
    expect(under?.y).toBeCloseTo((over?.y ?? 0) + 4, 5);
  });

  it("tints a white copy of the run with the shadow colour, at the shadow alpha", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "<color=#ff0000>x</color>", style: "hud.title" }));
    const [under, over] = object.children;

    expect(styleOfObject(under).fill).toBe(0xff_ff_ff);
    expect(under?.tint).toBe(0x5b_3a_1e);
    expect(under?.alpha).toBe(0.5);
    expect(styleOfObject(over).fill).toBe(0xff_00_00);
    expect(over?.alpha).toBe(1);
  });

  it("draws the shadow opaque when the style left the alpha out", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "12", style: "hud.solid" }));

    expect(object.children[0]?.alpha).toBe(1);
    expect(object.children[0]?.tint).toBe(0);
  });

  it("gives the shadow the synthetic bold and italic of its run", () => {
    const mock = shadowed();
    const bold = build(mock, value({ resolved: "<b>b</b>", style: "hud.title" }));
    const italic = build(mock, value({ resolved: "<i>i</i>", style: "hud.title" }));

    expect(bold.children).toHaveLength(10);
    expect(bold.children[0]?.tint).toBe(0x5b_3a_1e);
    expect(styleOfObject(bold.children[0]).stroke).toBeUndefined();
    expect(italic.children[0]?.skew.x).toBe(-0.2);
  });

  it("draws an icon once: a shadow is cast by glyphs only", () => {
    const mock = shadowed();
    const object = build(mock, value({ resolved: "<icon=hud.coin>", style: "hud.title" }));

    expect(object.children.map(child => child.kind)).toEqual(["Sprite"]);
  });

  it("writes the new content into the shadow with the run, in place", () => {
    const mock = shadowed();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12", style: "hud.title" }));
    const before = [...object.children];

    entry?.adapter.update(
      object,
      value({ resolved: "12", style: "hud.title" }),
      value({ resolved: "7", style: "hud.title" })
    );

    expect(before.map(child => child.destroyed)).toEqual([false, false]);
    expect(object.children).toEqual(before);
    expect(object.children.map(child => textOf(child))).toEqual(["7", "7"]);
    expect(object.children[0]?.tint).toBe(0x5b_3a_1e);
    expect(object.children[0]?.x).toBeCloseTo((object.children[1]?.x ?? 0) + 2, 5);
    expect(object.children[0]?.y).toBeCloseTo((object.children[1]?.y ?? 0) + 4, 5);
  });

  it("frees the shadow with the run", () => {
    const mock = shadowed();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12", style: "hud.title" }));
    const children = [...object.children];

    entry?.adapter.destroy(object);

    expect(children).toHaveLength(2);
    expect(children.map(child => child.destroyed)).toEqual([true, true]);
  });

  it("measures a shadowed style like the same style without one", () => {
    const mock = shadowed();

    expect(mock.api.measure("a\nbc", "hud.title")).toEqual(mock.api.measure("a\nbc", "hud.plain"));
  });
});

describe("the outline of a style", () => {
  /** The shadow of `hud.shadowed`. */
  const shadow = { color: 0x5b_3a_1e, dx: 0, dy: 4, alpha: 0.5 };

  /** A started plugin whose renderer draws, with outlined styles thin and wide, and a plain one. */
  function outlined(): MockText {
    const base = { font: "ui.font-body", size: 32, fill: 0xff_f3_d6, stroke: 0x3b_2a_1e };
    const mock = createMockText({
      features: [
        {
          name: "popup",
          description: {
            textStyles: defineTextStyles({
              "hud.outlined": { ...base, strokeWidth: 4 },
              "hud.wide": { ...base, strokeWidth: 6 },
              "hud.shadowed": { ...base, strokeWidth: 4, shadow },
              "hud.bolded": { ...base, strokeWidth: 4, bold: "ui.font-bold" },
              "hud.plain": { ...base }
            })
          }
        }
      ]
    });

    mock.renderer.ready = true;
    mock.start();

    return mock;
  }

  it("draws 8 white copies around the run, tinted with the stroke, the run last", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "12", style: "hud.outlined", anchor: zero }));
    const copies = object.children.slice(0, 8);
    const run = object.children[8];

    expect(object.children).toHaveLength(9);
    expect(copies.map(copy => textOf(copy))).toEqual(Array.from({ length: 8 }, () => "12"));
    expect(copies.map(copy => styleOfObject(copy).fill)).toEqual(
      Array.from({ length: 8 }, () => 0xff_ff_ff)
    );
    expect(copies.map(copy => copy.tint)).toEqual(Array.from({ length: 8 }, () => 0x3b_2a_1e));
    expect(copies.map(copy => copy.alpha)).toEqual(Array.from({ length: 8 }, () => 1));
    expect(offsetsOf(copies, run)).toEqual(ring(8, 4));
    expect(styleOfObject(run).fill).toBe(0xff_f3_d6);
    expect(run?.tint).toBe(0xff_ff_ff);
  });

  it("draws 12 copies when the stroke is 6 wide or more", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "12", style: "hud.wide", anchor: zero }));

    expect(object.children).toHaveLength(13);
    expect(offsetsOf(object.children.slice(0, 12), object.children[12])).toEqual(ring(12, 6));
  });

  it("draws no copies when the stroke width is 0", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "12", style: "hud.plain" }));

    expect(object.children).toHaveLength(1);
  });

  it("hands no stroke to BitmapText", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "a<b>b</b>", style: "hud.shadowed" }));

    expect(object.children.map(child => styleOfObject(child).stroke)).toEqual(
      object.children.map(() => undefined)
    );
  });

  it("puts the shadow under the outline, and the outline under the run", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "12", style: "hud.shadowed" }));
    const tints = object.children.map(child => child.tint);

    expect(object.children).toHaveLength(10);
    expect(tints[0]).toBe(0x5b_3a_1e);
    expect(object.children[0]?.alpha).toBe(0.5);
    expect(tints.slice(1, 9)).toEqual(Array.from({ length: 8 }, () => 0x3b_2a_1e));
    expect(tints[9]).toBe(0xff_ff_ff);
  });

  it("draws a synthetic bold run as outline copies, then bold copies in the fill, then the run", () => {
    const mock = outlined();
    const object = build(
      mock,
      value({ resolved: "<b>b</b>", style: "hud.outlined", anchor: zero })
    );
    const run = object.children[16];
    const outline = object.children.slice(0, 8);
    const bold = object.children.slice(8, 16);

    expect(object.children).toHaveLength(17);
    expect(outline.map(copy => copy.tint)).toEqual(Array.from({ length: 8 }, () => 0x3b_2a_1e));
    expect(offsetsOf(outline, run)).toEqual(ring(8, 4));
    expect(bold.map(copy => styleOfObject(copy).fill)).toEqual(
      Array.from({ length: 8 }, () => 0xff_ff_ff)
    );
    expect(bold.map(copy => copy.tint)).toEqual(Array.from({ length: 8 }, () => 0xff_f3_d6));
    expect(offsetsOf(bold, run)).toEqual(ring(8, 1.6));
  });

  it("draws a run of the bold font with the outline only", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "<b>b</b>", style: "hud.bolded" }));

    expect(object.children).toHaveLength(9);
    expect(styleOfObject(object.children[8]).fontFamily).toBe("ui.font-bold");
  });

  it("leans the copies of an italic run with it", () => {
    const mock = outlined();
    const object = build(mock, value({ resolved: "<i>i</i>", style: "hud.outlined" }));

    expect(object.children.map(child => child.skew.x)).toEqual(
      Array.from({ length: 9 }, () => -0.2)
    );
  });

  it("keeps the outline and the bold copies of a ticking counter, their ring around the run", () => {
    const mock = outlined();
    const entry = mock.renderer.provided[0];
    const previous = value({ resolved: "<b>12</b>", style: "hud.outlined", anchor: zero });
    const object = build(mock, previous);
    const before = [...object.children];

    entry?.adapter.update(
      object,
      previous,
      value({ resolved: "<b>13</b>", style: "hud.outlined", anchor: zero })
    );

    const run = object.children[16];

    expect(object.children).toHaveLength(17);
    expect(object.children.every((child, index) => child === before[index])).toBe(true);
    expect(object.children.map(child => textOf(child))).toEqual(
      Array.from({ length: 17 }, () => "13")
    );
    expect(offsetsOf(object.children.slice(0, 8), run)).toEqual(ring(8, 4));
    expect(offsetsOf(object.children.slice(8, 16), run)).toEqual(ring(8, 1.6));
    expect(object.children.map(child => child.tint).slice(0, 8)).toEqual(
      Array.from({ length: 8 }, () => 0x3b_2a_1e)
    );
  });

  it("keeps the box: the run sits where it sits without an outline, and measure is the same", () => {
    const mock = outlined();
    const withOutline = build(mock, value({ resolved: "12", style: "hud.outlined" }));
    const without = build(mock, value({ resolved: "12", style: "hud.plain" }));

    expect(withOutline.children[8]?.x).toBe(without.children[0]?.x);
    expect(withOutline.children[8]?.y).toBe(without.children[0]?.y);
    expect(mock.api.measure("a\nbc", "hud.outlined")).toEqual(
      mock.api.measure("a\nbc", "hud.plain")
    );
  });
});

describe("installFonts", () => {
  it("parses the advance table and installs the font once", () => {
    const mock = drawing();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: coinTexture });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.renderer.installed).toEqual(["ui.font-body"]);
    expect(mock.state.tables.get("ui.font-body")?.size).toBe(32);
  });

  it("installs nothing headless, and still measures from the table", () => {
    const mock = createMockText();

    mock.start();
    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: coinTexture });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.renderer.installed).toEqual([]);
    expect(mock.state.tables.has("ui.font-body")).toBe(true);
    expect(mock.api.measure("12", "body")).toEqual({ width: 36, height: 40 });
  });

  it("builds nothing while the renderer is inert", () => {
    const mock = createMockText();

    mock.start();

    expect(mock.renderer.provided).toHaveLength(1);
    expect(mock.renderer.provided[0]?.adapter.create(value({ resolved: "12" }), 1)).toBeUndefined();
  });
});

/** A wrapped style with the defaults of `body`, registered by every case. */
function wrapping(mock: MockText, over: Partial<TextStyle> = {}): void {
  mock.state.styles.set("wrapped", { ...centred, align: "left", wrap: 80, ...over });
}

describe("the display adapter — icons inside wrapped text", () => {
  // No font is loaded here: a glyph is 19.2 px, a line and an icon 38.4 px.

  it("places an icon on the second line at the line height, at the x its line gives", () => {
    const mock = drawing();

    wrapping(mock);

    const object = build(
      mock,
      value({ resolved: "11 <icon=hud.coin>1", style: "wrapped", anchor: zero })
    );
    const [first, sprite, after] = object.children;

    expect(object.children.map(child => child.kind)).toEqual([
      "BitmapText",
      "Sprite",
      "BitmapText"
    ]);
    expect(textOf(first)).toBe("11");
    expect(sprite?.texture).toBe(coinTexture);
    expect(rounded(sprite?.x ?? -1, sprite?.y ?? -1)).toEqual({ x: 0, y: 38.4 });
    expect(sprite?.width).toBeCloseTo(38.4, 5);
    expect(sprite?.height).toBeCloseTo(38.4, 5);
    expect(rounded(after?.x ?? -1, after?.y ?? -1)).toEqual({ x: 38.4, y: 38.4 });
  });

  it("aligns the line that holds the icon inside the widest one", () => {
    const mock = drawing();

    wrapping(mock, { align: "center" });

    const object = build(
      mock,
      value({ resolved: "111 <icon=hud.coin>", style: "wrapped", anchor: zero })
    );
    const sprite = object.children[1];

    expect(sprite?.kind).toBe("Sprite");
    expect(rounded(sprite?.x ?? -1, sprite?.y ?? -1)).toEqual({ x: 9.6, y: 38.4 });
  });

  it("moves the sprite when an update moves the icon to another line", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];

    wrapping(mock);

    const previous = value({ resolved: "1 <icon=hud.coin>", style: "wrapped", anchor: zero });
    const next = value({ resolved: "11 <icon=hud.coin>", style: "wrapped", anchor: zero });
    const object = build(mock, previous);
    const before = object.children[1];

    expect(rounded(before?.x ?? -1, before?.y ?? -1)).toEqual({ x: 38.4, y: 0 });

    entry?.adapter.update(object, previous, next);

    const sprites = object.children.filter(child => child.kind === "Sprite");

    expect(sprites).toHaveLength(1);
    expect(rounded(sprites[0]?.x ?? -1, sprites[0]?.y ?? -1)).toEqual({ x: 0, y: 38.4 });
  });

  it("keeps one sprite per icon per line when a tick changes only the text", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];

    wrapping(mock);

    const previous = value({ resolved: "11 <icon=hud.coin>1", style: "wrapped", anchor: zero });
    const next = value({ resolved: "12 <icon=hud.coin>2", style: "wrapped", anchor: zero });
    const object = build(mock, previous);
    const before = [...object.children];

    entry?.adapter.update(object, previous, next);

    expect(object.children.every((child, index) => child === before[index])).toBe(true);
    expect(object.children.map(child => textOf(child))).toEqual(["12", undefined, "2"]);
    expect(rounded(before[1]?.x ?? -1, before[1]?.y ?? -1)).toEqual({ x: 0, y: 38.4 });
  });
});

describe("the alpha of a Text", () => {
  // No font is loaded here, so no run is drawn with Pixi's distance-field shader.

  it("writes the alpha on every object of the block; the container stays at 1", () => {
    const mock = drawing();
    const object = build(mock, value({ resolved: "Your name", alpha: 0.5 }));

    expect(object.alpha).toBe(1);
    expect(object.children.map(child => child.alpha)).toEqual([0.5]);
  });

  it("patches a changed alpha in place without rebuilding the runs", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const previous = value({ resolved: "<icon=hud.coin>12", alpha: 1 });
    const object = build(mock, previous);
    const before = [...object.children];

    entry?.adapter.update(object, previous, value({ resolved: "<icon=hud.coin>12", alpha: 0.25 }));

    expect(object.alpha).toBe(1);
    expect(object.children.map(child => child.alpha)).toEqual([0.25, 0.25]);
    expect(object.children.every((child, index) => child === before[index])).toBe(true);
    expect(before.map(child => child.destroyed)).toEqual([false, false]);
  });

  it("writes the alpha with a new text in the same update", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const previous = value({ resolved: "12" });
    const object = build(mock, previous);

    entry?.adapter.update(object, previous, value({ resolved: "13", alpha: 0.5 }));

    expect(object.children[0]?.alpha).toBe(0.5);
    expect(textOf(object.children[0])).toBe("13");
  });
});

/** Lands the MSDF fixture font, as a bundle that just loaded. */
function loadMsdf(mock: MockText): void {
  mock.assets.fonts.set("ui.font-body", { fnt: miniFontMsdfXml, texture: coinTexture });
  mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
}

describe("the alpha of a Text on an MSDF font", () => {
  // Pixi 8.21's MSDF shader multiplies the group alpha in twice; `msdfOpacity` is that shader
  // (alpha.test.ts holds it against the shader step by step), so it reads what Pixi draws.

  /** Deep ink, the fill of the fixture's `ui.field` style. */
  const deepInk = 0x24_12_0a;

  /** Ink, the outline and the shadow colour of the fixture. */
  const ink = 0x3a_22_12;

  /** Cream, the fill of the outlined fixture words. */
  const cream = 0xff_f3_d6;

  /** A drawing plugin with the MSDF fixture font loaded and three styles over it. */
  function msdf(): MockText {
    const mock = drawing();

    mock.state.styles.set("field", { ...centred, fill: deepInk });
    mock.state.styles.set("outlined", { ...centred, fill: cream, stroke: ink, strokeWidth: 3 });
    mock.state.styles.set("shadowed", {
      ...centred,
      fill: cream,
      shadow: { color: ink, dx: 0, dy: 8, alpha: 0.55 }
    });
    loadMsdf(mock);

    return mock;
  }

  it("hands Pixi the alpha its MSDF shader draws at the asked alpha", () => {
    const mock = msdf();
    const object = build(mock, value({ resolved: "12", style: "field", alpha: 0.5 }));
    const run = object.children[0];

    expect(run?.alpha).toBeCloseTo(0.7029, 4);
    expect(msdfOpacity(run?.alpha ?? 0, deepInk)).toBeCloseTo(0.5, 6);
    expect(object.alpha).toBe(1);
  });

  it("draws an MSDF run opaque at alpha 1", () => {
    const mock = msdf();
    const object = build(mock, value({ resolved: "12", style: "field" }));

    expect(object.children[0]?.alpha).toBe(1);
  });

  it("draws an icon beside an MSDF run at the alpha as it is", () => {
    const mock = msdf();
    const object = build(
      mock,
      value({ resolved: "<icon=hud.coin>12", style: "field", alpha: 0.5 })
    );
    const [sprite, run] = object.children;

    expect(sprite?.kind).toBe("Sprite");
    expect(sprite?.alpha).toBe(0.5);
    expect(msdfOpacity(run?.alpha ?? 0, deepInk)).toBeCloseTo(0.5, 6);
  });

  it("gives every copy of an outline the alpha its own colour needs", () => {
    const mock = msdf();
    const object = build(mock, value({ resolved: "12", style: "outlined", alpha: 0.5 }));
    const copies = object.children.slice(0, -1);
    const run = object.children.at(-1);

    expect(copies).toHaveLength(8);
    expect(copies.map(copy => msdfOpacity(copy.alpha, ink))).toEqual(
      copies.map(() => expect.closeTo(0.5, 6))
    );
    expect(msdfOpacity(run?.alpha ?? 0, cream)).toBeCloseTo(0.5, 6);
    expect(copies[0]?.alpha).not.toBeCloseTo(run?.alpha ?? 0, 3);
  });

  it("keeps the look of a shadow at alpha 1 and fades it once with the block", () => {
    const mock = msdf();
    const opaque = build(mock, value({ resolved: "12", style: "shadowed" }));
    const faded = build(mock, value({ resolved: "12", style: "shadowed", alpha: 0.5 }));

    expect(opaque.children[0]?.alpha).toBeCloseTo(0.55, 10);
    expect(msdfOpacity(faded.children[0]?.alpha ?? 0, ink)).toBeCloseTo(
      0.5 * msdfOpacity(0.55, ink),
      6
    );
    expect(msdfOpacity(faded.children[1]?.alpha ?? 0, cream)).toBeCloseTo(0.5, 6);
  });

  it("writes the compensated alpha in place on a tween step", () => {
    const mock = msdf();
    const entry = mock.renderer.provided[0];
    const previous = value({ resolved: "12", style: "field" });
    const object = build(mock, previous);
    const before = [...object.children];

    entry?.adapter.update(object, previous, value({ resolved: "12", style: "field", alpha: 0.5 }));

    expect(object.children.every((child, index) => child === before[index])).toBe(true);
    expect(msdfOpacity(object.children[0]?.alpha ?? 0, deepInk)).toBeCloseTo(0.5, 6);
  });

  it("compensates a label drawn before its font landed on the next update", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const current = value({ resolved: "12", alpha: 0.5 });
    const object = build(mock, current);

    expect(object.children[0]?.alpha).toBe(0.5);

    loadMsdf(mock);
    entry?.adapter.update(object, current, current);

    expect(msdfOpacity(object.children[0]?.alpha ?? 0, 0xff_ff_ff)).toBeCloseTo(0.5, 6);
  });

  it("leaves a plain bitmap font at the alpha as it is", () => {
    const mock = drawing();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: coinTexture });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    const object = build(mock, value({ resolved: "12", alpha: 0.5 }));

    expect(object.children[0]?.alpha).toBe(0.5);
  });
});
