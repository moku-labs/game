import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "../../../i18n/types";
import type { PixiTexture } from "../../../renderer/types";
import { component } from "../../../world/ecs/define";
import type { Entity } from "../../../world/ecs/types";
import { bind, defineTextStyles, Text } from "../../components";
import { createHandlers } from "../../handlers";
import type { TextValue } from "../../types";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type FakeObject, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The `assets:replaced` hook: a dev hot swap put new bytes behind asset keys.
// When it fires `assets` answers the new font and the new texture already, and
// the old page and the old texture are destroyed. A replaced font is installed
// again; a label drawn with a replaced font or inline icon is marked and built
// again on the next frame, even when its string stands still.
// ---------------------------------------------------------------------------

/** The two fonts of the config, and the two a feature style names. */
const BODY = "ui.font-body";
const DIGITS = "ui.font-digits";
const BOLD = "ui.font-bold";
const TITLE = "ui.font-title";

/** The page a font was loaded with, and the page a saved file brought. */
const oldPage = { label: "page.old" } as unknown as PixiTexture;
const newPage = { label: "page.new" } as unknown as PixiTexture;

/** The texture an icon was loaded with, and the one a saved file brought. */
const oldCoin = { label: "coin.old" } as unknown as PixiTexture;
const newCoin = { label: "coin.new" } as unknown as PixiTexture;

/** The fixture font with wider glyphs and a taller line: what a saved `.fnt` brings. */
const widerFontJson = JSON.stringify({
  info: { face: "mini", size: 32 },
  common: { lineHeight: 48 },
  chars: [
    { id: 49, char: "1", xadvance: 20 },
    { id: 50, char: "2", xadvance: 24 }
  ]
});

/** A message whose sentence holds an icon element. */
const messages: Record<string, Record<string, Part[]>> = {
  ru: {
    "hud.coins": [
      { kind: "element", node: { type: "icon", props: { name: "hud.coin" }, children: [] } },
      { kind: "text", text: " 25" }
    ]
  }
};

/** The component a HUD counter binds to. */
const Counter = component("Counter", { value: 0 });

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A started plugin whose renderer draws, with both config fonts and the coin loaded. */
function drawing(): MockText {
  const mock = createMockText({
    features: [
      {
        name: "hud",
        description: {
          textStyles: defineTextStyles({
            "hud.rich": { font: BODY, bold: BOLD, size: 32, fill: 0xff_ff_ff },
            "hud.title": { font: TITLE, size: 32, fill: 0xff_ff_ff }
          })
        }
      }
    ],
    messages
  });

  mock.renderer.ready = true;
  mock.assets.fonts.set(BODY, { fnt: miniFontJson, texture: oldPage });
  mock.assets.fonts.set(DIGITS, { fnt: miniFontJson, texture: oldPage });
  mock.assets.textures.set("hud.coin", oldCoin);
  mock.start();

  return mock;
}

/** One `Text` value with the fields a case is about. */
function value(over: Partial<TextValue> = {}): TextValue {
  return { ...Text.defaults, ...over };
}

/** The registered display adapter. */
function adapterOf(mock: MockText): NonNullable<MockText["renderer"]["provided"][0]>["adapter"] {
  const entry = mock.renderer.provided[0];

  if (entry === undefined) throw new Error("no adapter was registered");

  return entry.adapter;
}

/** How many times the plugin wrote the `Text` of an entity. */
function writesOf(mock: MockText, entity: Entity): number {
  return mock.world.writes.filter(write => write.entity === entity && write.component === "Text")
    .length;
}

/** Puts a label into the fake world and runs one layout phase. */
function place(mock: MockText, entity: Entity, over: Partial<TextValue>): void {
  mock.world.put(entity, Text, value(over));
  mock.step();
}

/**
 * Puts a label in the world, runs a frame, and builds its container, as the renderer does.
 *
 * @param mock - The mock plugin.
 * @param entity - The entity the label sits on.
 * @param over - The fields of the label.
 * @returns The container and the value it was built from.
 */
function mounted(
  mock: MockText,
  entity: Entity,
  over: Partial<TextValue>
): { object: FakeObject; shown: TextValue } {
  place(mock, entity, over);

  const shown = { ...(mock.world.read(entity, Text) as TextValue) };

  return { object: adapterOf(mock).create(shown, entity) as FakeObject, shown };
}

/**
 * Runs a frame the way the engine does: the layout phase first, then phase `sync` hands the
 * adapter the label only when `changed(Text)` names it, that is when the layout phase wrote it.
 *
 * @param mock - The mock plugin.
 * @param entity - The entity the label sits on.
 * @param object - The container of the label.
 * @param previous - The value the container was last drawn from.
 */
function frame(mock: MockText, entity: Entity, object: FakeObject, previous: TextValue): void {
  const before = writesOf(mock, entity);

  mock.step();

  if (writesOf(mock, entity) === before) return;

  adapterOf(mock).update(object, previous, mock.world.read(entity, Text) as TextValue);
}

/** One label on the screen: its entity, its container and the value the container was built from. */
type Mounted = { entity: Entity; object: FakeObject; shown: TextValue };

/**
 * Runs one frame over several labels the way the engine does: one layout phase for all of them,
 * then phase `sync` hands the adapter every label that phase wrote, and no other.
 *
 * @param mock - The mock plugin.
 * @param labels - The labels on the screen.
 */
function frameAll(mock: MockText, labels: readonly Mounted[]): void {
  const before = labels.map(label => writesOf(mock, label.entity));

  mock.step();

  for (const [index, label] of labels.entries()) {
    if (writesOf(mock, label.entity) === before[index]) continue;

    adapterOf(mock).update(
      label.object,
      label.shown,
      mock.world.read(label.entity, Text) as TextValue
    );
  }
}

describe("the assets:replaced hook — a font", () => {
  it("installs a replaced font again, from the new file and the new page", () => {
    const mock = drawing();

    expect(mock.renderer.installed).toEqual([BODY, DIGITS]);
    expect(mock.api.measure("12", "body")).toEqual({ width: 36, height: 40 });

    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });

    expect(mock.renderer.installed).toEqual([BODY, DIGITS, BODY]);
    expect(mock.renderer.pages.get(BODY)).toBe(newPage);
    expect(mock.renderer.pages.get(DIGITS)).toBe(oldPage);
    expect(mock.api.measure("12", "body")).toEqual({ width: 44, height: 48 });
    expect(mock.reload).not.toHaveBeenCalled();
  });

  it("installs every font of one swap again", () => {
    const mock = drawing();

    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.assets.fonts.set(DIGITS, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY, "hud.coin", DIGITS] });

    expect(mock.renderer.installed).toEqual([BODY, DIGITS, BODY, DIGITS]);
    expect(mock.renderer.pages.get(DIGITS)).toBe(newPage);
  });

  it("marks the labels drawn with the font and moves the generation once", () => {
    const mock = drawing();

    place(mock, 1, { content: "12" });
    place(mock, 2, { content: "12", style: "hud.rich" });

    expect(mock.state.dirty.size).toBe(0);

    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });

    expect(mock.state.dirty.has(1)).toBe(true);
    expect(mock.state.dirty.has(2)).toBe(true);
    expect(mock.state.generation).toBe(1);
  });

  it("marks the labels of the replaced font, and no label of another font", () => {
    const mock = drawing();

    place(mock, 1, { content: "12" });
    place(mock, 2, { content: "12", style: "hud.rich" });
    place(mock, 3, { content: "12", style: "digits" });
    place(mock, 4, { content: "12", style: "hud.title" });

    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });

    expect([...mock.state.dirty].toSorted((first, second) => first - second)).toEqual([1, 2]);
    expect(mock.state.generation).toBe(1);
  });

  it("draws the label of the replaced font again, and no label of another font", () => {
    const mock = drawing();
    const body: Mounted = { entity: 1, ...mounted(mock, 1, { content: "12" }) };
    const digits: Mounted = { entity: 2, ...mounted(mock, 2, { content: "12", style: "digits" }) };
    const bodyGlyphs = body.object.children[0];
    const digitsGlyphs = digits.object.children[0];
    const digitsWrites = writesOf(mock, 2);

    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });
    frameAll(mock, [body, digits]);

    // The label of the replaced font: measured with the new table, built from the new page.
    expect(mock.state.measured.get(1)).toEqual({ width: 44, height: 48 });
    expect(bodyGlyphs?.destroyed).toBe(true);
    expect(body.object.children[0]).not.toBe(bodyGlyphs);

    // The label of the other font: not written, not measured again, its objects kept.
    expect(writesOf(mock, 2)).toBe(digitsWrites);
    expect(mock.state.measured.get(2)).toEqual({ width: 36, height: 40 });
    expect(digits.object.children).toHaveLength(1);
    expect(digits.object.children[0]).toBe(digitsGlyphs);
    expect(digitsGlyphs?.destroyed).toBe(false);
  });

  it("counts the bold font of a style as a font of its labels", () => {
    const mock = drawing();

    place(mock, 1, { content: "<b>12</b>", style: "hud.rich" });
    mock.assets.fonts.set(BOLD, { fnt: miniFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BOLD] });

    expect(mock.renderer.pages.get(BOLD)).toBe(newPage);
    expect(mock.state.dirty.has(1)).toBe(true);
    expect(mock.state.generation).toBe(1);
  });

  it("moves no generation for a font no label is drawn with", () => {
    const mock = drawing();

    place(mock, 1, { content: "12" });
    mock.assets.fonts.set(DIGITS, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [DIGITS] });

    expect(mock.renderer.pages.get(DIGITS)).toBe(newPage);
    expect(mock.state.generation).toBe(0);
  });

  it("draws a label again whose string stands still, with glyphs of the new font", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, 1, { content: "12" });
    const before = object.children[0];

    // The same file with a new page: the string, the style and the layout all stand still.
    mock.assets.fonts.set(BODY, { fnt: miniFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });
    frame(mock, 1, object, shown);

    expect(mock.world.read(1, Text)?.resolved).toBe("12");
    expect(before?.destroyed).toBe(true);
    expect(object.children).toHaveLength(1);
    expect(object.children[0]).not.toBe(before);
    expect(object.children[0]?.kind).toBe("BitmapText");
    expect(object.children[0]?.text).toBe("12");
  });

  it("draws it again once: the next update keeps the new objects", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, 1, { content: "12" });

    mock.assets.fonts.set(BODY, { fnt: miniFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] });
    frame(mock, 1, object, shown);

    const rebuilt = object.children[0];
    const writes = writesOf(mock, 1);

    mock.step();
    adapterOf(mock).update(object, shown, { ...shown });

    expect(writesOf(mock, 1)).toBe(writes);
    expect(object.children[0]).toBe(rebuilt);
    expect(rebuilt?.destroyed).toBe(false);
  });

  it("writes a bound label again though its number stands still, and draws it again", () => {
    const mock = drawing();

    mock.world.put(7, Counter, { value: 12 });

    const { object, shown } = mounted(mock, 7, { style: "digits", bind: bind(Counter, "value") });
    const before = object.children[0];
    const writes = writesOf(mock, 7);

    expect(shown.resolved).toBe("12");

    mock.assets.fonts.set(DIGITS, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [DIGITS] });
    frame(mock, 7, object, shown);

    expect(writesOf(mock, 7)).toBe(writes + 1);
    expect(mock.world.read(7, Text)?.resolved).toBe("12");
    expect(mock.state.measured.get(7)).toEqual({ width: 44, height: 48 });
    expect(before?.destroyed).toBe(true);
    expect(object.children[0]).not.toBe(before);

    mock.step();

    expect(writesOf(mock, 7)).toBe(writes + 1);
  });

  it("logs a font file that cannot be read and reloads the page", () => {
    const mock = drawing();

    place(mock, 1, { content: "12" });
    mock.assets.fonts.set(BODY, { fnt: "not a font", texture: newPage });

    expect(() => mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY] })).not.toThrow();
    expect(mock.log.error).toHaveBeenCalledTimes(1);
    expect(mock.log.error).toHaveBeenCalledWith("text:font-replace-failed", {
      key: BODY,
      reason: expect.stringContaining('Font "ui.font-body" is not BMFont XML or JSON.')
    });
    expect(mock.reload).toHaveBeenCalledTimes(1);
    expect(mock.state.generation).toBe(0);
  });

  it("logs what the renderer refused in its own words, and stops at the first font", () => {
    const mock = drawing();

    mock.renderer.refuses = "the page is gone";
    mock.assets.fonts.set(BODY, { fnt: widerFontJson, texture: newPage });
    mock.assets.fonts.set(DIGITS, { fnt: widerFontJson, texture: newPage });
    mock.hooks["assets:replaced"]({ bundle: "ui", keys: [BODY, DIGITS] });

    expect(mock.log.error).toHaveBeenCalledTimes(1);
    expect(mock.log.error).toHaveBeenCalledWith("text:font-replace-failed", {
      key: BODY,
      reason: "the page is gone"
    });
    expect(mock.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads the page through location.reload when no seam was passed", () => {
    const mock = drawing();
    const reload = vi.fn();

    vi.stubGlobal("location", { reload });
    mock.assets.fonts.set(BODY, { fnt: "not a font", texture: newPage });
    createHandlers(mock.ctx)["assets:replaced"]({ bundle: "ui", keys: [BODY] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.reload).not.toHaveBeenCalled();
  });

  it("fails without a throw where there is no page to reload", () => {
    const mock = drawing();

    vi.stubGlobal("location", undefined);
    mock.assets.fonts.set(BODY, { fnt: "not a font", texture: newPage });

    expect(() =>
      createHandlers(mock.ctx)["assets:replaced"]({ bundle: "ui", keys: [BODY] })
    ).not.toThrow();
    expect(mock.log.error).toHaveBeenCalledTimes(1);
  });
});

describe("the assets:replaced hook — an inline icon", () => {
  it("marks the labels that hold an icon of the key, and no other", () => {
    const mock = drawing();

    place(mock, 1, { content: "<icon=hud.coin> 5" });
    place(mock, 2, { content: "+5" });
    place(mock, 3, { content: "<icon=hud.gem>" });
    place(mock, 4, { content: { key: "hud.coins" } });
    // An escaped bracket is text that reads like a tag, not an icon.
    place(mock, 5, { content: String.raw`\<icon=hud.coin>` });

    expect(mock.world.read(4, Text)?.resolved).toBe("<icon=hud.coin> 25");
    expect(mock.state.dirty.size).toBe(0);

    mock.assets.textures.set("hud.coin", newCoin);
    mock.hooks["assets:replaced"]({ bundle: "hud", keys: ["hud.coin"] });

    expect([...mock.state.dirty].toSorted((first, second) => first - second)).toEqual([1, 4]);
    expect(mock.state.generation).toBe(1);
  });

  it("gives the sprite of a label whose string stands still the new texture", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, 1, { content: "<icon=hud.coin>12" });
    const writes = writesOf(mock, 1);

    expect(object.children[0]?.texture).toBe(oldCoin);

    mock.assets.textures.set("hud.coin", newCoin);
    mock.hooks["assets:replaced"]({ bundle: "hud", keys: ["hud.coin"] });
    frame(mock, 1, object, shown);

    expect(writesOf(mock, 1)).toBe(writes + 1);
    expect(mock.world.read(1, Text)?.resolved).toBe("<icon=hud.coin>12");
    expect(object.children.map(child => child.kind)).toEqual(["Sprite", "BitmapText"]);
    expect(object.children[0]?.texture).toBe(newCoin);
  });

  it("leaves the fonts, the layouts and the other labels alone", () => {
    const mock = drawing();

    place(mock, 1, { content: "<icon=hud.coin> 5" });
    place(mock, 2, { content: "+5" });

    const cached = mock.state.cache.size;
    const writes = writesOf(mock, 2);

    mock.assets.textures.set("hud.coin", newCoin);
    mock.hooks["assets:replaced"]({ bundle: "hud", keys: ["hud.coin"] });
    mock.step();

    expect(mock.renderer.installed).toEqual([BODY, DIGITS]);
    expect(mock.state.cache.size).toBe(cached);
    expect(writesOf(mock, 2)).toBe(writes);
    expect(mock.reload).not.toHaveBeenCalled();
  });

  it("moves the generation once per swap that marked a label", () => {
    const mock = drawing();

    place(mock, 1, { content: "<icon=hud.coin> 5" });
    mock.hooks["assets:replaced"]({ bundle: "hud", keys: ["hud.coin"] });
    mock.hooks["assets:replaced"]({ bundle: "hud", keys: ["hud.coin"] });

    expect(mock.state.generation).toBe(2);
  });
});

describe("the assets:replaced hook — a key no label is drawn with", () => {
  it("marks nothing and moves nothing", () => {
    const mock = drawing();

    place(mock, 1, { content: "<icon=hud.coin> 5" });
    place(mock, 2, { content: "12", style: "hud.rich" });

    const cached = mock.state.cache.size;

    mock.hooks["assets:replaced"]({ bundle: "board", keys: ["board.cell", "board.pop"] });

    expect(mock.state.dirty.size).toBe(0);
    expect(mock.state.generation).toBe(0);
    expect(mock.renderer.installed).toEqual([BODY, DIGITS]);
    expect(mock.state.cache.size).toBe(cached);
    expect(mock.log.error).not.toHaveBeenCalled();
    expect(mock.reload).not.toHaveBeenCalled();
  });

  it("keeps the objects of a drawn label on its next update", () => {
    const mock = drawing();
    const { object, shown } = mounted(mock, 1, { content: "12" });
    const before = object.children[0];

    mock.hooks["assets:replaced"]({ bundle: "board", keys: ["board.cell"] });
    adapterOf(mock).update(object, shown, { ...shown });

    expect(object.children[0]).toBe(before);
    expect(before?.destroyed).toBe(false);
  });
});
