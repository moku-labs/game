import { describe, expect, it } from "vitest";
import { defineTextStyles } from "../../components";
import type { TextStyles } from "../../types";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// What `onStart` opens and `onStop` closes: the style table of the features,
// the font keys, the system, the two world hooks and the display adapter.
// ---------------------------------------------------------------------------

/** The styles of the HUD feature. */
const hudStyles: TextStyles = defineTextStyles({
  "hud.digits": { font: "ui.font-digits", size: 40, fill: 0xff_e0_82, digits: true }
});

/** The styles of the orders feature, which also ships a bold font. */
const orderStyles: TextStyles = defineTextStyles({
  "orders.title": { font: "ui.font-title", bold: "ui.font-title-bold", size: 32, fill: 0 }
});

/** A started plugin with both features. */
function withFeatures(): MockText {
  const mock = createMockText({
    features: [
      { name: "hud", description: { textStyles: hudStyles } },
      { name: "orders", description: { textStyles: orderStyles } }
    ]
  });

  mock.start();

  return mock;
}

describe("startText", () => {
  it("puts the built-ins first and the features after, in feature order", () => {
    const mock = withFeatures();

    expect([...mock.state.styles.keys()]).toEqual(["body", "digits", "hud.digits", "orders.title"]);
  });

  it("collects every font a style can draw with", () => {
    const mock = withFeatures();

    expect([...mock.state.fontKeys]).toEqual([
      "ui.font-body",
      "ui.font-digits",
      "ui.font-title",
      "ui.font-title-bold"
    ]);
  });

  it("lets a feature override a built-in style by name", () => {
    const mock = createMockText({
      features: [
        {
          name: "hud",
          description: {
            textStyles: defineTextStyles({ body: { font: "ui.font-body", size: 24, fill: 1 } })
          }
        }
      ]
    });

    mock.start();

    expect(mock.state.styles.get("body")?.size).toBe(24);
  });

  it("names both features when two of them define the same style", () => {
    const mock = createMockText({
      features: [
        { name: "hud", description: { textStyles: hudStyles } },
        { name: "orders", description: { textStyles: hudStyles } }
      ]
    });

    expect(() => {
      mock.start();
    }).toThrow(
      '[game] Text style "hud.digits" is defined by features "hud" and "orders".\n' +
        "  Keep it in one feature or rename one of them."
    );
  });

  it("skips a feature that brought no style map, and an entry that is not a style", () => {
    const mock = createMockText({
      features: [
        { name: "none", description: {} },
        { name: "bad", description: { textStyles: { kind: "textStyles", map: { x: { y: 1 } } } } }
      ]
    });

    mock.start();

    expect([...mock.state.styles.keys()]).toEqual(["body", "digits"]);
  });

  it("registers the layout system, the two world hooks and the adapter", () => {
    const mock = withFeatures();

    expect(mock.world.systems.map(system => system.name)).toEqual(["text.resolve"]);
    expect(mock.world.systems[0]?.phase).toBe("layout");
    expect(mock.renderer.provided).toHaveLength(1);
    expect(mock.state.removers).toHaveLength(4);
  });
});

describe("stopText", () => {
  it("calls every remover and leaves nothing behind", () => {
    const mock = withFeatures();

    mock.stop();

    expect(mock.world.systems).toEqual([]);
    expect(mock.renderer.removedDisplays).toBe(1);
    expect(mock.state.removers).toEqual([]);
    expect(mock.state.styles.size).toBe(0);
    expect(mock.state.fontKeys.size).toBe(0);
    expect(mock.state.tables.size).toBe(0);
  });
});

describe("the hooks", () => {
  it("wakes the clock on a locale change, so the re-resolve runs at once", () => {
    const mock = withFeatures();

    mock.hooks["i18n:locale-changed"]({ locale: "en" });

    expect(mock.wake).toHaveBeenCalledTimes(1);
    expect(mock.state.cache.size).toBe(0);
  });

  it("drops the table of a font a bundle took away, and installs it again next time", () => {
    const mock = withFeatures();

    mock.renderer.ready = true;
    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.renderer.installed).toEqual(["ui.font-body"]);

    mock.renderer.installed.length = 0;
    mock.hooks["assets:bundle-unloaded"]({
      bundle: "boot",
      tier: "boot",
      mb: 1,
      reason: "request",
      keys: ["ui.font-body"]
    });

    expect(mock.state.tables.has("ui.font-body")).toBe(false);
    expect(mock.state.installed.has("ui.font-body")).toBe(false);

    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.renderer.installed).toEqual(["ui.font-body"]);
  });

  it("leaves the tables alone when the keys that left are not fonts", () => {
    const mock = withFeatures();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
    mock.hooks["assets:bundle-unloaded"]({
      bundle: "board",
      tier: "scene",
      mb: 3,
      reason: "budget",
      keys: ["board.cell"]
    });

    expect(mock.state.tables.has("ui.font-body")).toBe(true);
  });
});
