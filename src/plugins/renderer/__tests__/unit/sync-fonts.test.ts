import { afterEach, describe, expect, it, vi } from "vitest";
import type { PixiTexture } from "../../types";
import { FakeBitmapFont, FakeTexture, fakeCache } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const bmfontText = "info face=Hud\nchar id=65";
const bmfontXml = '<font><info face="Hud" /></font>';

async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();

  return mock;
}

function texture(): PixiTexture {
  return new FakeTexture({}) as unknown as PixiTexture;
}

describe("sync fonts", () => {
  it("installs a BMFont text file under its asset key", async () => {
    const mock = await started();
    const page = texture();

    expect(mock.api.sync.fonts.installed("hud.body")).toBe(false);

    mock.api.sync.fonts.install("hud.body", bmfontText, page);

    expect(mock.api.sync.fonts.installed("hud.body")).toBe(true);
    expect(FakeBitmapFont.made).toHaveLength(1);
    expect(FakeBitmapFont.made[0]?.data).toEqual({
      chars: { text: true },
      pages: ["page.png"],
      fontFamily: "face=Hud"
    });
    expect(FakeBitmapFont.made[0]?.textures).toEqual([page]);
    expect(fakeCache.entries.get("hud.body-bitmap")).toBe(FakeBitmapFont.made[0]);
  });

  it("reads a BMFont XML file and a BMFont JSON file", async () => {
    const mock = await started();

    mock.api.sync.fonts.install("hud.xml", bmfontXml, texture());
    mock.api.sync.fonts.install(
      "hud.json",
      '{ "chars": { "A": {} }, "pages": [{ "id": 0 }] }',
      texture()
    );

    expect(FakeBitmapFont.made[0]?.data).toEqual({
      chars: { xml: true },
      pages: ["page.png"],
      fontFamily: "<font>"
    });
    expect(FakeBitmapFont.made[1]?.data).toEqual({ chars: { A: {} }, pages: [{ id: 0 }] });
    expect(mock.api.sync.fonts.installed("hud.json")).toBe(true);
  });

  it("replaces a font that was installed under the same key", async () => {
    const mock = await started();

    mock.api.sync.fonts.install("hud.body", bmfontText, texture());
    mock.api.sync.fonts.install("hud.body", bmfontXml, texture());

    expect(FakeBitmapFont.made).toHaveLength(2);
    expect(fakeCache.entries.get("hud.body-bitmap")).toBe(FakeBitmapFont.made[1]);
  });

  it("refuses a file that is neither BMFont text, XML nor JSON", async () => {
    const mock = await started();

    expect(() => mock.api.sync.fonts.install("hud.body", "nonsense", texture())).toThrow(
      '[game] Font "hud.body" is not a BMFont file.\n' +
        "  Export it as .fnt (BMFont text or XML) or as BMFont JSON."
    );
  });

  it("refuses to install a font while nothing can draw", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(() => mock.api.sync.fonts.install("hud.body", bmfontText, texture())).toThrow(
      "[game] Fonts need a renderer.\n  Call fonts.install after renderer.host.ready()."
    );
    expect(mock.api.sync.fonts.installed("hud.body")).toBe(false);
  });

  it("forgets the installed fonts when the renderer stops", async () => {
    const mock = await started();

    mock.api.sync.fonts.install("hud.body", bmfontText, texture());
    mock.stop();

    expect(mock.api.sync.fonts.installed("hud.body")).toBe(false);
    expect(fakeCache.has("hud.body-bitmap")).toBe(false);
    expect(FakeBitmapFont.made.at(-1)?.destroyed).toBe(true);
  });
});
