import { describe, expect, it, vi } from "vitest";
import type { Part } from "../../../i18n/types";
import { component } from "../../../world/ecs/define";
import { bind, builtInStyles, Countdown, Text } from "../../components";
import { drawsWith, markDirty } from "../../resolve";
import type { TextBind } from "../../types";
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
    place(mock, 1, { style: "digits", bind: bind(Counter, "value") });

    expect(mock.world.read(1, Text)?.resolved).toBe("12");

    mock.world.put(1, Counter, { value: 12.6 });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("13");
    expect(mock.world.writes.filter(write => write.component === "Text")).toHaveLength(2);
  });

  it("never asks i18n for a bound label", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 7 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value") });
    mock.step();

    expect(mock.i18n.formatted).toEqual([]);
  });

  it("warns once for a component name the world never met", () => {
    const mock = started();

    // Built by hand on purpose: no component named "Ghost" exists, so `bind()` cannot make it.
    const ghost = { component: "Ghost", field: "value", format: "int" } as TextBind;

    place(mock, 1, { style: "digits", bind: ghost });
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
    // Built by hand on purpose: `bind()` refuses a field that is not numeric.
    const named = { component: "Counter", field: "name", format: "int" } as TextBind;

    place(mock, 1, { style: "digits", bind: named });
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
    place(mock, 1, { style: "body", bind: bind(Counter, "value") });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("5");
    expect(warningsOf(mock, "text: bind on a style without digits")).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: bind on a style without digits", {
      style: "body"
    });
  });
});

describe("the layout system — a bound time", () => {
  it("shows a field of milliseconds as mm:ss", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) });

    expect(mock.world.read(1, Text)?.resolved).toBe("01:35");
  });

  it("writes nothing while the whole second stands still", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) });

    const before = mock.world.writes.length;

    mock.world.put(1, Counter, { value: 94_500 });
    mock.step();

    expect(mock.world.writes).toHaveLength(before);

    mock.world.put(1, Counter, { value: 94_000 });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("01:34");
    expect(mock.world.writes.slice(before)).toEqual([
      { entity: 1, component: "Text", patch: { resolved: "01:34" } }
    ]);
  });

  it("formats a duration through i18n once per whole second and again after a locale change", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "duration" }) });

    expect(mock.world.read(1, Text)?.resolved).toBe("ru:95s");

    mock.world.put(1, Counter, { value: 94_500 });
    mock.step();
    mock.world.put(1, Counter, { value: 94_000 });
    mock.step();
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("ru:94s");
    expect(mock.i18n.durations).toEqual([95_000, 94_000]);

    mock.i18n.locale = "en";
    mock.hooks["i18n:locale-changed"]({ locale: "en" });
    mock.step();
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("en:94s");
    expect(mock.i18n.durations).toEqual([95_000, 94_000, 94_000]);
  });

  it("leaves an int or a clock format alone on a locale change", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) });

    const before = mock.world.writes.length;

    mock.i18n.locale = "en";
    mock.hooks["i18n:locale-changed"]({ locale: "en" });
    mock.step();

    expect(mock.world.writes).toHaveLength(before);
  });

  it("warns once for a format it does not know and shows the int", () => {
    const mock = started();
    // Built by hand on purpose: `bind()` refuses a format that is not a `TextFormat`.
    const bad = { component: "Counter", field: "value", format: "ss" } as unknown as TextBind;

    mock.world.put(1, Counter, { value: 12.6 });
    place(mock, 1, { style: "digits", bind: bad });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("13");
    expect(warningsOf(mock, "text: bad bind format")).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: bad bind format", {
      component: "Counter",
      field: "value",
      format: "ss"
    });
  });

  it("warns once for a value that is not finite and shows 0", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: Number.NaN });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("0");
    expect(warningsOf(mock, "text: bad bind format")).toHaveLength(1);
  });

  it("formats again when the format of a bind changes", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value") });

    expect(mock.world.read(1, Text)?.resolved).toBe("95000");

    mock.world.put(1, Text, {
      ...mock.world.read(1, Text),
      bind: bind(Counter, "value", { format: "mm:ss" })
    });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("01:35");
  });
});

describe("the layout system — a countdown", () => {
  /** The moment the fake clock starts at. */
  const start = 1_000_000;

  /** A started plugin with one chest timer 95 s away on entity 1. */
  function chest(): MockText {
    const mock = started();

    mock.world.put(1, Countdown, Countdown({ until: start + 95_000 }).value);
    place(mock, 1, { style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) });

    return mock;
  }

  it("shows the time left until the moment and writes `left`", () => {
    const mock = chest();

    expect(mock.world.read(1, Text)?.resolved).toBe("01:35");
    expect(mock.world.read(1, Countdown)?.left).toBe(95_000);
  });

  it("ticks once per whole second, writing `left` once with the string", () => {
    const mock = chest();
    const before = mock.world.writes.length;

    mock.clock.advance(1000);
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("01:34");
    expect(
      mock.world.writes.slice(before).filter(write => write.component === "Countdown")
    ).toEqual([{ entity: 1, component: "Countdown", patch: { left: 94_000 } }]);
  });

  it("writes nothing on a frame inside the same second", () => {
    const mock = chest();
    const before = mock.world.writes.length;

    mock.clock.advance(400);
    mock.step();

    expect(mock.world.writes).toHaveLength(before);
    expect(mock.world.read(1, Countdown)?.left).toBe(95_000);
  });

  it("stops at zero and writes nothing after", () => {
    const mock = chest();

    mock.clock.advance(200_000);
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("00:00");
    expect(mock.world.read(1, Countdown)?.left).toBe(0);

    const before = mock.world.writes.length;

    mock.clock.advance(5000);
    mock.step();

    expect(mock.world.writes).toHaveLength(before);
  });

  it("warns once and shows nothing on an entity without a Countdown", () => {
    const mock = started();

    place(mock, 1, { style: "digits", bind: bind(Countdown, "left", { format: "mm:ss" }) });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("");
    expect(warningsOf(mock, "text: bound field is not a number")).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledWith("text: bound field is not a number", {
      component: "Countdown",
      field: "left"
    });
  });

  it("reads the clock once per frame, whatever the number of countdowns", () => {
    const mock = started();

    mock.world.put(1, Countdown, Countdown({ until: start + 95_000 }).value);
    mock.world.put(2, Countdown, Countdown({ until: start + 5000 }).value);
    mock.world.put(1, Text, Text({ style: "digits", bind: bind(Countdown, "left") }).value);
    mock.world.put(2, Text, Text({ style: "digits", bind: bind(Countdown, "left") }).value);
    mock.step();

    expect(mock.clockNow).toHaveBeenCalledTimes(1);

    mock.step();

    expect(mock.clockNow).toHaveBeenCalledTimes(2);
  });

  it("never reads the clock for a bound field of another component", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 7 });
    place(mock, 1, { style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) });
    place(mock, 2, { content: "+5" });

    expect(mock.clockNow).not.toHaveBeenCalled();
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

describe("markDirty", () => {
  it("marks every label when it is handed no predicate, and says how many", () => {
    const mock = started();

    place(mock, 1, { content: { key: "hud.orders" } });
    place(mock, 2, { content: "+5" });

    expect(markDirty(mock.ctx)).toBe(2);
    expect([...mock.state.dirty]).toEqual([1, 2]);
  });

  it("marks only the labels the predicate keeps", () => {
    const mock = started();

    place(mock, 1, { content: "+5" });
    place(mock, 2, { content: "+5", style: "digits" });
    place(mock, 3, { content: "+7" });

    expect(markDirty(mock.ctx, text => text.style === "digits")).toBe(1);
    expect([...mock.state.dirty]).toEqual([2]);
  });

  it("marks nothing when the predicate keeps no label", () => {
    const mock = started();

    place(mock, 1, { content: "+5" });

    expect(markDirty(mock.ctx, () => false)).toBe(0);
    expect(mock.state.dirty.size).toBe(0);
  });
});

describe("drawsWith", () => {
  it("is true for a font the style of the label names: regular, bold or italic", () => {
    const mock = started();

    mock.state.styles.set("rich", {
      ...builtInStyles(mock.ctx.config.fonts).body,
      bold: "ui.font-bold",
      italic: "ui.font-italic"
    });

    const text = Text({ content: "12", style: "rich" }).value;

    expect(drawsWith(mock.ctx, text, ["ui.font-body"])).toBe(true);
    expect(drawsWith(mock.ctx, text, ["board.cell", "ui.font-bold"])).toBe(true);
    expect(drawsWith(mock.ctx, text, ["ui.font-italic"])).toBe(true);
    expect(drawsWith(mock.ctx, text, ["ui.font-digits"])).toBe(false);
    expect(drawsWith(mock.ctx, text, [])).toBe(false);
  });

  it("is true for an inline icon of the resolved text, read through the tag grammar", () => {
    const mock = started();
    const icon = { ...Text.defaults, resolved: "×<icon=hud.coin>5" };
    const escaped = { ...Text.defaults, resolved: String.raw`\<icon=hud.coin>` };

    expect(drawsWith(mock.ctx, icon, ["hud.coin"])).toBe(true);
    expect(drawsWith(mock.ctx, icon, ["hud.gem"])).toBe(false);
    expect(drawsWith(mock.ctx, escaped, ["hud.coin"])).toBe(false);
  });

  it("reads an unknown style as body, the style the label is drawn with", () => {
    const mock = started();
    const text = { ...Text.defaults, style: "hud.nope", resolved: "12" };

    expect(drawsWith(mock.ctx, text, ["ui.font-body"])).toBe(true);
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
