import { describe, expect, it } from "vitest";
import { Text } from "../../components";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The three hooks: a bundle brings fonts, a bundle takes them away, a locale change
// marks every message. Each one only marks state; the layout system does the work.
// ---------------------------------------------------------------------------

/** A started plugin with a drawing renderer. */
function started(): MockText {
  const mock = createMockText();

  mock.renderer.ready = true;
  mock.start();

  return mock;
}

describe("createHandlers", () => {
  it("installs the fonts a bundle brought, once per key", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });

    expect(mock.renderer.installed).toEqual(["ui.font-body"]);
    expect(mock.state.tables.has("ui.font-body")).toBe(true);
  });

  it("writes a label again when its font arrives, so the display rebuilds without a new string", () => {
    const mock = started();

    mock.world.put(1, Text, Text({ content: "+5" }).value);
    mock.step();

    const before = mock.world.writes.filter(write => write.component === "Text").length;

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
    mock.step();

    expect(mock.world.writes.filter(write => write.component === "Text")).toHaveLength(before + 1);
    expect(mock.world.read(1, Text)?.resolved).toBe("+5");
  });

  it("releases only the fonts among the keys that left", () => {
    const mock = started();

    mock.assets.fonts.set("ui.font-body", { fnt: miniFontJson, texture: undefined as never });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 1, reason: "boot" });
    mock.hooks["assets:bundle-unloaded"]({
      bundle: "board",
      tier: "scene",
      mb: 1,
      reason: "budget",
      keys: ["board.cell", "ui.font-body"]
    });

    expect(mock.state.tables.has("ui.font-body")).toBe(false);
    expect(mock.state.installed.has("ui.font-body")).toBe(false);
  });

  it("marks every label on a locale change and wakes the clock once", () => {
    const mock = started();

    mock.world.put(1, Text, Text({ content: "+5" }).value);
    mock.step();
    mock.hooks["i18n:locale-changed"]({ locale: "en" });

    expect(mock.wake).toHaveBeenCalledTimes(1);
    expect(mock.state.cache.size).toBe(0);
  });
});
