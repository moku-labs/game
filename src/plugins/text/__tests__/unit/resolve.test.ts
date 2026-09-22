import { describe, expect, it, vi } from "vitest";
import type { Part } from "../../../i18n/types";
import { component } from "../../../world/ecs/define";
import { Text } from "../../components";
import { miniFontJson } from "../fixtures/mini-font";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The frame step: what `Text.resolved` holds after one layout phase, and how
// little happens when nothing moved. The world store is a fake; the real one
// runs the same system in the integration test.
// ---------------------------------------------------------------------------

/** The component a HUD counter binds to. */
const Counter = component("Counter", { value: 0 });

/** The two locales of the fake `i18n`. */
const messages: Record<string, Record<string, Part[]>> = {
  ru: {
    "hud.orders": [{ kind: "text", text: "3 заказа" }],
    "hud.coins": [
      { kind: "element", node: { type: "icon", props: { name: "hud.coin" }, children: [] } },
      { kind: "text", text: " 25" }
    ],
    "hud.button": [
      { kind: "element", node: { type: "button", props: {}, children: [] } },
      { kind: "text", text: "go" }
    ]
  },
  en: { "hud.orders": [{ kind: "text", text: "3 orders" }] }
};

/**
 * The warnings one message was written with, so a case counts the one it is about.
 *
 * @param mock - The mock plugin.
 * @param message - The log event to count.
 * @returns The calls that carried it.
 */
function warningsOf(mock: MockText, message: string): unknown[][] {
  return vi.mocked(mock.log.warn).mock.calls.filter(call => call[0] === message);
}

/** A started plugin with the two locales wired. */
function started(): MockText {
  const mock = createMockText({ messages });

  mock.start();

  return mock;
}

/** Puts a label into the fake world and runs one layout phase. */
function place(mock: MockText, entity: number, value: Partial<Parameters<typeof Text>[0]>): void {
  mock.world.put(entity, Text, Text(value).value);
  mock.step();
}

describe("the layout system — plain content", () => {
  it("takes a string as it is", () => {
    const mock = started();

    place(mock, 1, { content: "+5" });

    expect(mock.world.read(1, Text)?.resolved).toBe("+5");
  });

  it("formats a message through i18n and writes it through ecs.set", () => {
    const mock = started();

    place(mock, 1, { content: { key: "hud.orders" } });

    expect(mock.world.read(1, Text)?.resolved).toBe("3 заказа");
    expect(mock.world.writes).toEqual([
      { entity: 1, component: "Text", patch: { resolved: "3 заказа" } }
    ]);
  });

  it("turns an icon element of a message into an icon tag", () => {
    const mock = started();

    place(mock, 1, { content: { key: "hud.coins" } });

    expect(mock.world.read(1, Text)?.resolved).toBe("<icon=hud.coin> 25");
  });

  it("drops an element that is not an icon and warns", () => {
    const mock = started();

    place(mock, 1, { content: { key: "hud.button" } });

    expect(mock.world.read(1, Text)?.resolved).toBe("go");
    expect(mock.log.warn).toHaveBeenCalledWith("text: message element dropped", {
      key: "hud.button",
      element: "button"
    });
  });

  it("writes nothing on a frame where nothing moved", () => {
    const mock = started();

    place(mock, 1, { content: "+5" });
    mock.step();
    mock.step();

    expect(mock.world.writes).toHaveLength(1);
  });

  it("measures the block and keeps the size for ui", () => {
    const mock = started();

    place(mock, 1, { content: "12" });

    expect(mock.state.measured.get(1)?.width).toBeCloseTo(38.4, 5);
    expect(mock.state.measured.get(1)?.height).toBeCloseTo(38.4, 5);
  });

  it("measures an unknown style as body, and says so once", () => {
    const mock = started();

    place(mock, 1, { content: "12", style: "nope" });
    mock.state.dirty.add(1);
    mock.step();

    expect(mock.state.measured.get(1)?.width).toBeCloseTo(38.4, 5);
    expect(warningsOf(mock, "text: unknown style")).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: unknown style", { style: "nope" });
  });

  it("forgets an entity whose Text left", () => {
    const mock = started();

    place(mock, 1, { content: "+5" });
    mock.world.drop(1, Text);

    expect(mock.state.measured.has(1)).toBe(false);
    expect(mock.state.seen.has(1)).toBe(false);
  });
});

describe("the layout system — a bound number", () => {
  it("shows the rounded field and writes only when it moved", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 12.4 });
    place(mock, 1, { style: "digits", bind: { component: "Counter", field: "value" } });

    expect(mock.world.read(1, Text)?.resolved).toBe("12");

    mock.world.put(1, Counter, { value: 12.6 });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("13");
    expect(mock.world.writes.filter(write => write.component === "Text")).toHaveLength(2);
  });

  it("never asks i18n for a bound label", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 7 });
    place(mock, 1, { style: "digits", bind: { component: "Counter", field: "value" } });
    mock.step();

    expect(mock.i18n.formatted).toEqual([]);
  });

  it("warns once for a component name the world never met", () => {
    const mock = started();

    place(mock, 1, { style: "digits", bind: { component: "Ghost", field: "value" } });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("");
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: unknown bind component", {
      component: "Ghost"
    });
  });

  it("warns once when the bound field is not a number", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 0 });
    place(mock, 1, { style: "digits", bind: { component: "Counter", field: "name" } });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("");
    expect(mock.log.warn).toHaveBeenCalledWith("text: bound field is not a number", {
      component: "Counter",
      field: "name"
    });
  });

  it("still shows the number when the style is not a digits style, and says so once", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 5 });
    place(mock, 1, { style: "body", bind: { component: "Counter", field: "value" } });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("5");
    expect(warningsOf(mock, "text: bind on a style without digits")).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: bind on a style without digits", {
      style: "body"
    });
  });
});

describe("the layout system — a locale change", () => {
  it("re-resolves the messages and leaves the plain strings alone", () => {
    const mock = started();

    place(mock, 1, { content: { key: "hud.orders" } });
    place(mock, 2, { content: "+5" });

    mock.i18n.locale = "en";
    mock.hooks["i18n:locale-changed"]({ locale: "en" });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("3 orders");
    expect(mock.world.writes.filter(write => write.entity === 2)).toHaveLength(1);
    expect(mock.wake).toHaveBeenCalledTimes(1);
  });
});

describe("the layout cache", () => {
  it("lays the same content and style out once", () => {
    const mock = started();

    place(mock, 1, { content: "12" });
    place(mock, 2, { content: "12" });

    expect(mock.state.cache.size).toBe(1);
  });

  it("is cleared when a font arrives, and every label is measured again", () => {
    const mock = started();

    place(mock, 1, { content: "12" });
    mock.assets.fonts.set("ui.font-body", {
      fnt: miniFontJson,
      texture: undefined as unknown as never
    });
    mock.hooks["assets:bundle-loaded"]({ bundle: "boot", tier: "boot", mb: 0, reason: "boot" });

    expect(mock.state.cache.size).toBe(0);
    expect(mock.state.dirty.has(1)).toBe(true);

    mock.step();

    expect(mock.state.measured.get(1)).toEqual({ width: 36, height: 40 });
  });
});
