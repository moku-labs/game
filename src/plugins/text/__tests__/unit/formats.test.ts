import { describe, expect, it, vi } from "vitest";
import type { FeatureDescription } from "../../../flow/types";
import type { Part } from "../../../i18n/types";
import { component } from "../../../world/ecs/define";
import {
  Countdown,
  defineTextFormats,
  defineTextStyles,
  bind as rootBind,
  Text,
  textFor
} from "../../components";
import type { TextFormatAnswer, TextFormatFunction } from "../../types";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// A game's own format on a bound number (F135): registered per feature, asked
// for the whole value, and owner of the style of its label. The label is written
// the way `world` stores a component here: a new object per write, so `text` in
// a frame still holds the value from before the write.
// ---------------------------------------------------------------------------

/** The component a HUD pill binds to. */
const Counter = component("Counter", { value: 0 });

/** The entity of the label under test. */
const LABEL = 1;

/** The kit of a game that named one format, as `defineGame` hands it out. */
const { bind } = textFor<string, string, "pill.number" | "not.registered">();

/** The sizes of the fixture's pill, in a style with `digits` and one without. */
const pillStyles = defineTextStyles({
  "digits.17": { font: "ui.font-digits", size: 17, fill: 0, digits: true },
  "digits.14": { font: "ui.font-digits", size: 14, fill: 0, digits: true },
  letters: { font: "ui.font-body", size: 20, fill: 0 }
});

/**
 * The pill of the request: the number below a thousand, thousands with a K in a smaller style.
 *
 * @param value - The whole value.
 * @returns What the label shows.
 */
function pill(value: number): TextFormatAnswer {
  return value < 1000
    ? { content: String(value), style: "digits.17" }
    : { content: `${value / 1000}K`, style: "digits.14" };
}

/**
 * The description of a feature that brings the styles and one format.
 *
 * @param map - What goes under the `textFormats` key.
 * @returns The description.
 */
function describedWith(map: Record<string, unknown>): FeatureDescription {
  return {
    textStyles: pillStyles,
    textFormats: defineTextFormats(map as Record<string, TextFormatFunction>)
  };
}

/**
 * A started plugin with one format under the name `pill.number`.
 *
 * @param format - The function of the format.
 * @param messages - Formatted parts per locale and message key.
 * @returns The mock plugin.
 */
function started(
  format: TextFormatFunction = pill,
  messages?: Record<string, Record<string, Part[]>>
): MockText {
  const mock = createMockText({
    features: [{ name: "shared", description: describedWith({ "pill.number": format }) }],
    ...(messages === undefined ? {} : { messages })
  });

  mock.start();

  return mock;
}

/**
 * Puts a label bound to `Counter.value` through a format on the label entity.
 *
 * @param mock - The mock plugin.
 * @param value - The number the counter starts at.
 * @param style - The `style` prop of the label.
 * @param format - The format of the bind.
 */
function putLabel(
  mock: MockText,
  value: number,
  style = "digits.17",
  format: "pill.number" | "not.registered" | "int" = "pill.number"
): void {
  mock.world.put(LABEL, Counter, { value });
  mock.world.put(LABEL, Text, Text({ style, bind: bind(Counter, "value", { format }) }).value);
}

/**
 * Moves the counter and runs one frame.
 *
 * @param mock - The mock plugin.
 * @param value - The new number.
 */
function stepTo(mock: MockText, value: number): void {
  mock.world.api.ecs.set(LABEL, Counter, { value });
  mock.step();
}

/**
 * What the label shows now.
 *
 * @param mock - The mock plugin.
 * @returns `Text.resolved` and `Text.style`.
 */
function shown(mock: MockText): [unknown, unknown] {
  const text = mock.world.read(LABEL, Text);

  return [text?.resolved, text?.style];
}

/**
 * Every patch written to `Text` so far.
 *
 * @param mock - The mock plugin.
 * @returns The patches, in order.
 */
function textWrites(mock: MockText): Array<Record<string, unknown>> {
  return mock.world.writes.filter(write => write.component === "Text").map(write => write.patch);
}

/**
 * Counts the warnings of one log event.
 *
 * @param mock - The mock plugin.
 * @param message - The log event.
 * @returns How many times it was written.
 */
function warnings(mock: MockText, message: string): number {
  return vi.mocked(mock.log.warn).mock.calls.filter(call => call[0] === message).length;
}

describe("defineTextFormats registered at start", () => {
  it("refuses a name two features define, naming both", () => {
    const mock = createMockText({
      features: [
        { name: "shared", description: describedWith({ "pill.number": pill }) },
        { name: "shop", description: { textFormats: defineTextFormats({ "pill.number": pill }) } }
      ]
    });

    expect(() => mock.start()).toThrow(
      '[game] Text format "pill.number" is defined by features "shared" and "shop".\n' +
        "  Keep it in one feature or rename one of them."
    );
  });

  it("refuses a built-in name, naming the feature", () => {
    const mock = createMockText({
      features: [{ name: "shop", description: describedWith({ "mm:ss": pill }) }]
    });

    expect(() => mock.start()).toThrow(
      '[game] Text format "mm:ss" of feature "shop" is a built-in format.'
    );
  });

  it("refuses a value that is not a function, naming the feature", () => {
    const mock = createMockText({
      features: [{ name: "shop", description: describedWith({ "pill.number": "1.5K" }) }]
    });

    expect(() => mock.start()).toThrow(
      '[game] Text format "pill.number" of feature "shop" is not a function.'
    );
  });

  it("forgets every format at stop, so the same features start again", () => {
    const mock = started();

    mock.stop();

    expect(mock.api.formatted("pill.number", 1)).toBeUndefined();
    expect(() => mock.start()).not.toThrow();
    expect(mock.api.formatted("pill.number", 1)).toEqual({ text: "1", style: "digits.17" });
  });
});

describe("text.formatted", () => {
  it("hands the format the whole value, as int rounds it", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    expect(mock.api.formatted("pill.number", 999.6)).toEqual({ text: "1K", style: "digits.14" });
    expect(format).toHaveBeenCalledWith(1000);
  });

  it("hands the format 0 for a value that is not finite, and never -0", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    mock.api.formatted("pill.number", Number.NaN);
    mock.api.formatted("pill.number", -0.4);

    expect(format.mock.calls.every(([value]) => Object.is(value, 0))).toBe(true);
    expect(format).toHaveBeenCalledTimes(2);
  });

  it("formats a Message answer in the current locale", () => {
    const mock = started(() => ({ content: { key: "ui.k" }, style: "digits.14" }), {
      ru: { "ui.k": [{ kind: "text", text: "1,5 тыс." }] },
      en: { "ui.k": [{ kind: "text", text: "1.5K" }] }
    });

    expect(mock.api.formatted("pill.number", 1500)?.text).toBe("1,5 тыс.");

    mock.i18n.locale = "en";

    expect(mock.api.formatted("pill.number", 1500)?.text).toBe("1.5K");
  });

  it("answers undefined for a name no feature registered and for a built-in name", () => {
    const mock = started();

    expect(mock.api.formatted("not.registered", 5)).toBeUndefined();
    expect(mock.api.formatted("mm:ss", 95_000)).toBeUndefined();
    expect(mock.api.formatted("int", 5)).toBeUndefined();
  });

  it("answers undefined for a format that threw", () => {
    const mock = started(() => {
      throw new Error("no table");
    });

    expect(mock.api.formatted("pill.number", 5)).toBeUndefined();
    expect(warnings(mock, "text: bind format threw")).toBe(1);
  });
});

describe("a label over steps", () => {
  it("follows the answer in text and style, and keeps the size of the answer's style", () => {
    const mock = started();

    putLabel(mock, 950);
    mock.step();

    expect(shown(mock)).toEqual(["950", "digits.17"]);

    stepTo(mock, 1500);

    expect(shown(mock)).toEqual(["1.5K", "digits.14"]);
    expect(mock.state.measured.get(LABEL)).toEqual(mock.api.measure("1.5K", "digits.14"));

    stepTo(mock, 950);

    expect(shown(mock)).toEqual(["950", "digits.17"]);
    expect(mock.state.measured.get(LABEL)).toEqual(mock.api.measure("950", "digits.17"));
  });

  it("writes a step that changes the style alone", () => {
    const mock = started(value => ({
      content: "9+",
      style: value < 10 ? "digits.17" : "digits.14"
    }));

    putLabel(mock, 5);
    mock.step();
    stepTo(mock, 20);

    expect(shown(mock)).toEqual(["9+", "digits.14"]);
    expect(mock.state.measured.get(LABEL)).toEqual(mock.api.measure("9+", "digits.14"));
  });

  it("shows a value the entity does not carry as nothing, and asks nothing", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    mock.world.put(
      LABEL,
      Text,
      Text({ style: "letters", bind: bind(Counter, "value", { format: "pill.number" }) }).value
    );
    mock.step();

    expect(shown(mock)).toEqual(["", "letters"]);
    expect(format).not.toHaveBeenCalled();
    expect(warnings(mock, "text: bind on a style without digits")).toBe(0);
  });

  it("keeps Countdown.left with what a countdown label shows", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    mock.world.put(LABEL, Countdown, { until: mock.clock.now() + 2000, left: 0 });
    mock.world.put(
      LABEL,
      Text,
      Text({ style: "digits.17", bind: bind(Countdown, "left", { format: "pill.number" }) }).value
    );
    mock.step();

    expect(mock.world.read(LABEL, Countdown)?.left).toBe(2000);
    expect(shown(mock)).toEqual(["2K", "digits.14"]);

    mock.clock.advance(16);
    mock.step();

    expect(format).toHaveBeenCalledTimes(2);
    expect(mock.world.read(LABEL, Countdown)?.left).toBe(1984);
  });
});

describe("a format is asked only when its value moves", () => {
  it("calls it once while the whole value stands, over fractions of one whole too", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    // 1500 answers another style than the prop: `seen` holds the answer's, or every frame asks.
    putLabel(mock, 1500);
    mock.step();
    mock.step();
    stepTo(mock, 1500.3);
    stepTo(mock, 1499.8);

    expect(format).toHaveBeenCalledTimes(1);
    expect(format).toHaveBeenCalledWith(1500);
  });

  it("writes nothing on a step with the same answer", () => {
    const format = vi.fn((value: number) => ({
      content: value < 1000 ? "few" : "many",
      style: "digits.14"
    }));
    const mock = started(format);

    putLabel(mock, 5);
    mock.step();

    const written = textWrites(mock).length;

    stepTo(mock, 6);

    expect(format).toHaveBeenCalledTimes(2);
    expect(textWrites(mock)).toHaveLength(written);
    expect([...mock.world.api.ecs.changed(Text)]).toEqual([]);
  });

  it("asks again after a locale change and writes the Message in the new locale", () => {
    const format = vi.fn(() => ({ content: { key: "ui.k" }, style: "digits.14" }));
    const mock = started(format, {
      ru: { "ui.k": [{ kind: "text", text: "1,5 тыс." }] },
      en: { "ui.k": [{ kind: "text", text: "1.5K" }] }
    });

    putLabel(mock, 1500);
    mock.step();

    expect(shown(mock)).toEqual(["1,5 тыс.", "digits.14"]);

    mock.i18n.locale = "en";
    mock.hooks["i18n:locale-changed"]({ locale: "en" });
    mock.step();
    mock.step();

    expect(shown(mock)).toEqual(["1.5K", "digits.14"]);
    expect(format).toHaveBeenCalledTimes(2);
  });

  it("does not call it for a mark: the shown string is written again and measured", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    putLabel(mock, 1500);
    mock.step();
    mock.state.measured.clear();
    mock.world.writes.length = 0;
    mock.state.dirty.add(LABEL);
    mock.step();

    expect(format).toHaveBeenCalledTimes(1);
    expect(textWrites(mock)).toEqual([{ resolved: "1.5K" }]);
    expect(mock.state.measured.get(LABEL)).toEqual(mock.api.measure("1.5K", "digits.14"));
  });
});

describe("a format that cannot answer", () => {
  it("shows the whole value as digits and keeps the style when it throws, warned once per name", () => {
    const mock = started(() => {
      throw new Error("no table");
    });

    putLabel(mock, 1499.6, "digits.14");
    mock.step();
    stepTo(mock, 7);

    expect(shown(mock)).toEqual(["7", "digits.14"]);
    expect(warnings(mock, "text: bind format threw")).toBe(1);
  });

  it("shows an unknown name as int, warned once per entity, the style as it is", () => {
    const mock = started();

    putLabel(mock, 41.6, "digits.14", "not.registered");
    mock.step();
    stepTo(mock, 50);

    expect(shown(mock)).toEqual(["50", "digits.14"]);
    expect(warnings(mock, "text: bad bind format")).toBe(1);
  });

  it("hands the format 0 for a value that is not finite, warned once per entity", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    putLabel(mock, Number.POSITIVE_INFINITY);
    mock.step();
    mock.step();

    expect(shown(mock)).toEqual(["0", "digits.17"]);
    expect(format).toHaveBeenCalledTimes(1);
    expect(format).toHaveBeenCalledWith(0);
    expect(warnings(mock, "text: bad bind format")).toBe(1);
  });
});

describe("the style of a named label", () => {
  it("returns in the same frame after another writer put the style back", () => {
    const format = vi.fn(pill);
    const mock = started(format);

    putLabel(mock, 1500);
    mock.step();
    mock.world.api.ecs.set(LABEL, Text, { style: "digits.17" });
    mock.step();

    expect(shown(mock)).toEqual(["1.5K", "digits.14"]);
    expect(format).toHaveBeenCalledTimes(2);
  });

  it("returns after a whole rewrite by a projection, in the step after the flush too", () => {
    const mock = started();

    putLabel(mock, 1500);
    mock.step();
    mock.world.api.ecs.set(LABEL, Text, { style: "digits.17", resolved: "" });
    mock.afterLayout();

    expect(shown(mock)).toEqual(["1.5K", "digits.14"]);
  });

  it("writes no warning on a style without digits, on the first write and on a mark", () => {
    const mock = started(value => ({ content: String(value), style: "letters" }));

    putLabel(mock, 5, "letters");
    mock.step();
    mock.state.dirty.add(LABEL);
    mock.step();

    expect(shown(mock)).toEqual(["5", "letters"]);
    expect(warnings(mock, "text: bind on a style without digits")).toBe(0);
  });

  it("still warns for the same style under a built-in format", () => {
    const mock = started();

    mock.world.put(LABEL, Counter, { value: 5 });
    mock.world.put(LABEL, Text, Text({ style: "letters", bind: rootBind(Counter, "value") }).value);
    mock.step();

    expect(warnings(mock, "text: bind on a style without digits")).toBe(1);
  });
});
