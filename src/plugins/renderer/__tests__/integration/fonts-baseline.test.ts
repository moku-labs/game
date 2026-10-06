import { readFileSync } from "node:fs";
import * as pixi from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PixiModule, PixiTexture } from "../../types";
import { createMockRenderer } from "../mock-renderer";

// The mini game's body font, read as it ships: BMFont XML, MSDF, size 44, lineHeight 55, base 41.
const FONT_KEY = "ui.font-body";
const fnt = readFileSync(
  new URL(
    "../../../../../tests/fixtures/mini-game/features/ui/assets/font-body.fnt",
    import.meta.url
  ),
  "utf8"
);

/** A number the `.fnt` header declares, so the expected box comes from the file, not the code. */
function header(pattern: RegExp): number[] {
  const match = pattern.exec(fnt);

  if (match === null) throw new Error(`font-body.fnt has no ${String(pattern)}`);

  return match.slice(1).map(Number);
}

const [fontSize = 0] = header(/<info[^>]*\ssize="(\d+)"/);
const [lineHeight = 0] = header(/<common[^>]*\slineHeight="(\d+)"/);
const [padTop = 0, , padBottom = 0] = header(/<info[^>]*\spadding="(\d+),(\d+),(\d+),(\d+)"/);
// The capital И as the font draws it: its quad from `yoffset` below the line top, `height` tall.
const [capitalHeight = 0, capitalTop = 0] = header(
  /<char id="1048"[^>]*\sheight="(\d+)"[^>]*\syoffset="(-?\d+)"/
);
// Where the ink of И sits in the line box: its centre less the centre of the box, in font units.
// Pangolin leaves more room under its capitals than over them, so the band sits 2 units high.
const capitalOffset =
  (capitalTop + padTop + (capitalTop + capitalHeight - padBottom)) / 2 - lineHeight / 2;

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'"
};

type XmlElement = { getAttribute(name: string): string | null };

/**
 * The XML reader Pixi asks its DOM adapter for. Node has no `DOMParser`, and the one Pixi's web
 * worker adapter brings answers `""` for a missing attribute where a browser answers `null`, which
 * loses every glyph name. BMFont XML is flat, self-closing elements, so a scan is enough.
 */
function readXml(xml: string): Document {
  const elements: Array<{ tag: string; attributes: Map<string, string> }> = [];

  for (const piece of xml.split("<").slice(1)) {
    const body = piece.slice(0, piece.indexOf(">"));
    const [tag = ""] = body.split(/[\s/]/, 1);
    // `name="value"` pairs: split on the quotes, names sit at the even places.
    const parts = body.slice(tag.length).split('"');
    const attributes = new Map<string, string>();

    for (let at = 0; at + 1 < parts.length; at += 2) {
      const name = (parts[at] ?? "").trim();
      const value = (parts[at + 1] ?? "").replaceAll(
        /&\w+;/g,
        entity => ENTITIES[entity] ?? entity
      );

      attributes.set(name.endsWith("=") ? name.slice(0, -1) : name, value);
    }

    elements.push({ tag, attributes });
  }

  const document = {
    getElementsByTagName: (tag: string): XmlElement[] =>
      elements
        .filter(element => element.tag === tag)
        .map(element => ({
          // eslint-disable-next-line unicorn/no-null -- Pixi checks a missing attribute against null, as a browser answers.
          getAttribute: (name: string): string | null => element.attributes.get(name) ?? null
        }))
  };

  return document as unknown as Document;
}

/** The fake application and canvas, with the real bitmap-font pieces of Pixi. */
function withRealFonts(fake: PixiModule): PixiModule {
  return {
    ...fake,
    BitmapFont: pixi.BitmapFont,
    Cache: pixi.Cache,
    bitmapFontTextParser: pixi.bitmapFontTextParser,
    bitmapFontXMLStringParser: pixi.bitmapFontXMLStringParser
  };
}

type TextureInstruction = Extract<pixi.GraphicsInstructions, { action: "texture" }>;
type DrawText = (
  this: { getSdfShader(): undefined },
  text: pixi.BitmapText,
  proxy: { context: pixi.GraphicsContext }
) => void;

/**
 * The glyph quads Pixi draws for a label, in the label's local units: the real draw path of the
 * bitmap text pipe, recorded into a graphics context instead of a GPU buffer.
 */
function glyphQuads(text: pixi.BitmapText): Array<{ top: number; bottom: number }> {
  const draw = (pixi.AbstractBitmapTextPipe.prototype as unknown as { _updateContext: DrawText })
    ._updateContext;
  const proxy = { context: new pixi.GraphicsContext() };

  // The distance-field shader needs a GPU; the glyph positions do not.
  draw.call({ getSdfShader: () => undefined }, text, proxy);

  return proxy.context.instructions
    .filter((instruction): instruction is TextureInstruction => instruction.action === "texture")
    .map(({ data }) => ({
      top: data.transform.apply(new pixi.Point(data.dx, data.dy)).y,
      bottom: data.transform.apply(new pixi.Point(data.dx, data.dy + data.dh)).y
    }));
}

const browser = pixi.DOMAdapter.get();

beforeAll(() => {
  pixi.DOMAdapter.set({ ...browser, parseXML: readXml });
});

afterAll(() => {
  pixi.DOMAdapter.set(browser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer fonts: the baseline of a real BMFont", () => {
  it.each([
    { style: "ui.note", size: 52 },
    { style: "ui.counter", size: 120 }
  ])("draws the capital band of $style where the .fnt puts it in its text box, within 1 u", async ({
    size
  }) => {
    const mock = createMockRenderer({
      config: { loadPixi: () => Promise.resolve(withRealFonts(mock.pixi.module)) }
    });
    const page = new pixi.Texture({ source: new pixi.TextureSource({ width: 512, height: 512 }) });

    await mock.start();
    mock.api.sync.fonts.install(FONT_KEY, fnt, page as unknown as PixiTexture);

    const label = new pixi.BitmapText({
      text: "Играть",
      style: { fontFamily: FONT_KEY, fontSize: size }
    });
    const [capital] = glyphQuads(label);
    const scale = size / fontSize;
    // `text` lays a line out as a box of lineHeight * size / fontSize from the line top.
    const box = lineHeight * scale;

    if (capital === undefined) throw new Error("Pixi drew no glyph for И");

    // The quad of an MSDF glyph carries the padding around the ink.
    const bandTop = capital.top + padTop * scale;
    const bandBottom = capital.bottom - padBottom * scale;

    // Drawn from the line top: a glyph drawn lineHeight - base low would miss by 14 units at 44.
    expect(
      Math.abs((bandTop + bandBottom) / 2 - box / 2 - capitalOffset * scale)
    ).toBeLessThanOrEqual(1);

    mock.stop();
    label.destroy();
  });
});
