import { describe, expect, it, vi } from "vitest";
import type { Part } from "../../../i18n/types";
import { defineTextStyles } from "../../components";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The two members `ui.layout` and a dev overlay call. Both answer without a
// canvas, so the numbers below are the same in a browser and in plain Bun.
// ---------------------------------------------------------------------------

/** The parts the fake `i18n` answers with. */
const messages: Record<string, Record<string, Part[]>> = {
  ru: { "hud.orders": [{ kind: "text", text: "12" }] }
};

/**
 * The warnings one message was written with. Every warning goes through `ctx.log.warn`, so a case
 * that is about one of them counts that one.
 *
 * @param mock - The mock plugin.
 * @param message - The log event to count.
 * @returns The calls that carried it.
 */
function warningsOf(mock: MockText, message: string): unknown[][] {
  return vi.mocked(mock.log.warn).mock.calls.filter(call => call[0] === message);
}

/** A started plugin with one feature style. */
function started(): MockText {
  const mock = createMockText({
    messages,
    features: [
      {
        name: "hud",
        description: {
          textStyles: defineTextStyles({
            "hud.digits": { font: "ui.font-digits", size: 64, fill: 1, digits: true }
          })
        }
      }
    ]
  });

  mock.start();

  return mock;
}

/** A started plugin with a style that wraps at its box and one that wraps at 250. */
function carded(): MockText {
  const mock = createMockText({
    features: [
      {
        name: "card",
        description: {
          textStyles: defineTextStyles({
            "card.name": { font: "ui.font-body", size: 32, fill: 1, wrap: "box" },
            "card.note": { font: "ui.font-body", size: 32, fill: 1, wrap: 250 }
          })
        }
      }
    ]
  });

  mock.start();

  return mock;
}

describe("measure", () => {
  it("answers the fallback size while no font is loaded", () => {
    const mock = started();
    const size = mock.api.measure("120", "digits");

    expect(size.width).toBeCloseTo(57.6, 5);
    expect(size.height).toBeCloseTo(38.4, 5);
  });

  it("scales with the size of the style", () => {
    const mock = started();
    const size = mock.api.measure("12", "hud.digits");

    expect(size.width).toBeCloseTo(76.8, 5);
    expect(size.height).toBeCloseTo(76.8, 5);
  });

  it("formats a message before it measures it", () => {
    const mock = started();

    expect(mock.api.measure({ key: "hud.orders" }, "body").width).toBeCloseTo(38.4, 5);
    expect(mock.i18n.formatted).toEqual(["hud.orders"]);
  });

  it("measures from the advance table once the font is there", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.api.measure("12", "body")).toEqual({ width: 36, height: 40 });
  });

  it("measures an unknown style as body and warns once", () => {
    const mock = started();

    expect(mock.api.measure("12", "nope")).toEqual(mock.api.measure("12", "body"));
    expect(mock.api.measure("1", "nope")).toEqual(mock.api.measure("1", "body"));
    expect(warningsOf(mock, "text: unknown style")).toHaveLength(1);
  });

  // The bug: the width ui hands over is dropped, or the cache answers the layout of another width.
  // The numbers are the TextApi example: 19.2 a glyph and 38.4 a line on the 0.6 em fallback.
  it("wraps a box style at the width it is handed, and lays it on one line without one", () => {
    const mock = carded();
    const narrow = mock.api.measure("Aleksandra Kucherenko", "card.name", 200);
    const wide = mock.api.measure("Aleksandra Kucherenko", "card.name", 450);
    const free = mock.api.measure("Aleksandra Kucherenko", "card.name");

    expect(narrow.width).toBeCloseTo(192, 5);
    expect(narrow.height).toBeCloseTo(76.8, 5);
    expect(wide.width).toBeCloseTo(403.2, 5);
    expect(wide.height).toBeCloseTo(38.4, 5);
    expect(free.width).toBeCloseTo(403.2, 5);
    expect(free.height).toBeCloseTo(38.4, 5);
  });

  // The bug: a style with a width of its own wraps at the width of its element, or caches one
  // layout per width the layout tries.
  it("ignores the width for a style with a width of its own", () => {
    const mock = carded();
    const own = mock.api.measure("Aleksandra Kucherenko", "card.note");

    expect(mock.api.measure("Aleksandra Kucherenko", "card.note", 100)).toEqual(own);
    expect(mock.api.measure("Aleksandra Kucherenko", "card.note", 500)).toEqual(own);
    expect(own.height).toBeCloseTo(76.8, 5);
    expect(mock.state.cache.size).toBe(1);
  });

  it("lays the same content and style out once", () => {
    const mock = started();

    mock.api.measure("12", "body");
    mock.api.measure("12", "body");
    mock.api.measure("12", "digits");

    expect(mock.state.cache.size).toBe(2);
  });
});

describe("hasGlyph", () => {
  it("answers whether the font of the style has the character, as Pixi draws it", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.api.hasGlyph("A", "body")).toBe(true);
    expect(mock.api.hasGlyph("😀", "body")).toBe(false);
    expect(warningsOf(mock, "text: the font has no glyph")).toHaveLength(0);
  });

  it("matches measure: a character the font lacks is drawn as nothing and measures 0 wide", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.api.hasGlyph("😀", "body")).toBe(false);
    expect(mock.api.measure("A😀", "body")).toEqual(mock.api.measure("A", "body"));
    expect(mock.api.measure("A😀", "body").width).toBe(24);
  });

  it("answers true while the font is not loaded: the fallback measures every character", () => {
    const mock = started();

    expect(mock.api.hasGlyph("😀", "body")).toBe(true);
  });

  it("looks an unknown style up as body and warns once", () => {
    const mock = started();

    mock.api.hasGlyph("A", "nope");
    mock.api.hasGlyph("B", "nope");

    expect(warningsOf(mock, "text: unknown style")).toHaveLength(1);
  });
});

describe("the layout cache", () => {
  it("keeps at most 1024 blocks and drops the oldest first", () => {
    const mock = started();

    for (let index = 0; index <= 1024; index += 1) mock.api.measure(String(index), "body");

    expect(mock.state.cache.size).toBe(1024);
    expect([...mock.state.cache.keys()].some(key => key.endsWith("0"))).toBe(true);
  });
});

describe("styles", () => {
  it("lists the built-ins first, then the styles of every feature", () => {
    const mock = started();

    expect(mock.api.styles()).toEqual(["body", "digits", "hud.digits"]);
  });

  it("hands out a frozen list, so nobody registers a style by pushing", () => {
    const mock = started();

    expect(Object.isFrozen(mock.api.styles())).toBe(true);
  });
});
