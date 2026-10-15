import { readFileSync } from "node:fs";
import * as pixi from "pixi.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the pin under the text
// adapter's own check (spec 15 E9). A ticking label writes the string it shows
// into its BitmapText; Pixi skips a write of the same string. A Pixi that stops
// comparing fails here, so the upgrade looks at the adapter's check again.
// ---------------------------------------------------------------------------

/** The asset key of the mini game's body font, and the cache key the renderer installs it under. */
const FONT_KEY = "ui.font-body";

/** The mini game's body font as it ships: BMFont XML, MSDF. */
const fnt = readFileSync(
  new URL(
    "../../../../../tests/fixtures/mini-game/features/ui/assets/font-body.fnt",
    import.meta.url
  ),
  "utf8"
);

const browser = pixi.DOMAdapter.get();

beforeAll(() => {
  // Node has no DOMParser: Pixi's own adapter of a web worker parses the XML of the font.
  pixi.DOMAdapter.set({ ...browser, parseXML: pixi.WebWorkerAdapter.parseXML });

  const page = new pixi.Texture({ source: new pixi.TextureSource({ width: 512, height: 512 }) });
  const font = new pixi.BitmapFont({
    data: pixi.bitmapFontXMLStringParser.parse(fnt),
    textures: [page]
  });

  pixi.Cache.set(`${FONT_KEY}-bitmap`, font);
});

afterAll(() => {
  pixi.Cache.remove(`${FONT_KEY}-bitmap`);
  pixi.DOMAdapter.set(browser);
});

describe("a BitmapText of the real Pixi module", () => {
  it("Pixi skips a same-string write into a BitmapText", () => {
    const label = new pixi.BitmapText({
      text: "01:46",
      style: { fontFamily: FONT_KEY, fontSize: 40 }
    });

    // Laid out with the installed font, as a label the renderer drew.
    label.getLocalBounds();

    const viewUpdate = vi.spyOn(label, "onViewUpdate");

    label.text = "01:45";
    label.text = "01:45";

    expect(viewUpdate).toHaveBeenCalledTimes(1);
  });
});
