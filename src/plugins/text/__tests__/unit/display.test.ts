import { describe, expect, it } from "vitest";
import type { PixiTexture } from "../../../renderer/types";
import { defineTextStyles, Text } from "../../components";
import type { TextStyle, TextStyles, TextValue } from "../../types";
import { miniFontJson } from "../fixtures/mini-font";
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

/** The text a BitmapText was built with. */
function textOf(object: FakeObject | undefined): unknown {
  return object?.options.text;
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

  it("rebuilds on a changed resolved string", () => {
    const mock = drawing();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12" }));
    const before = object.children[0];

    entry?.adapter.update(object, value({ resolved: "12" }), value({ resolved: "1" }));

    expect(before?.destroyed).toBe(true);
    expect(object.children).toHaveLength(1);
    expect(object.children[0]).not.toBe(before);
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

  it("rebuilds the shadow with the run when the content changes", () => {
    const mock = shadowed();
    const entry = mock.renderer.provided[0];
    const object = build(mock, value({ resolved: "12", style: "hud.title" }));
    const before = [...object.children];

    entry?.adapter.update(
      object,
      value({ resolved: "12", style: "hud.title" }),
      value({ resolved: "7", style: "hud.title" })
    );

    expect(before.map(child => child.destroyed)).toEqual([true, true]);
    expect(object.children.map(child => textOf(child))).toEqual(["7", "7"]);
    expect(object.children[0]?.tint).toBe(0x5b_3a_1e);
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
