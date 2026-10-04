import { describe, expect, it } from "vitest";
import { compileMessage } from "../../compile/message";
import type { ElementNode } from "../../types";
import { kitOf, partsOf, textOf } from "./evaluate";

const coin: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

const ORDERS_RU = "{n, plural, one {# заказ} few {# заказа} many {# заказов} other {# заказа}}";

const ORDERS_EN = "{n, plural, one {# order} other {# orders}}";

describe("literal and argument", () => {
  it("compiles a message with no parameters to one text part", () => {
    expect(partsOf("Играть", "ru")).toEqual([{ kind: "text", text: "Играть" }]);
  });

  it("puts a string argument in the sentence", () => {
    expect(textOf("Привет, {name}!", "ru", { name: "Аня" })).toBe("Привет, Аня!");
  });

  it("formats a number in a plain argument through Intl.NumberFormat", () => {
    expect(textOf("{name}", "en", { name: 1234 })).toBe("1,234");
  });

  it("formats an array in a plain argument through Intl.ListFormat", () => {
    expect(textOf("{name}", "en", { name: ["Ann", "Bo", "Cy"] })).toBe("Ann, Bo, and Cy");
  });

  it("keeps an element argument as an element part", () => {
    expect(partsOf("Награда: {icon}", "ru", { icon: coin })).toEqual([
      { kind: "text", text: "Награда: " },
      { kind: "element", node: coin }
    ]);
  });

  it("types a plain argument as an argument and asks for the helper", () => {
    const compiled = compileMessage("Привет, {name}!");

    expect(compiled.params).toEqual({ name: { kind: "argument" } });
    expect(compiled.usesArgument).toBe(true);
  });

  it("asks for no helper when the message has no plain argument", () => {
    expect(compileMessage(ORDERS_EN).usesArgument).toBe(false);
  });
});

describe("plural", () => {
  it("picks the Russian categories one, few and many", () => {
    expect(textOf(ORDERS_RU, "ru", { n: 1 })).toBe("1 заказ");
    expect(textOf(ORDERS_RU, "ru", { n: 3 })).toBe("3 заказа");
    expect(textOf(ORDERS_RU, "ru", { n: 5 })).toBe("5 заказов");
  });

  it("picks the English categories one and other", () => {
    expect(textOf(ORDERS_EN, "en", { n: 1 })).toBe("1 order");
    expect(textOf(ORDERS_EN, "en", { n: 3 })).toBe("3 orders");
  });

  it("prefers an exact match over the category", () => {
    const message = "{n, plural, =0 {no orders} one {# order} other {# orders}}";

    expect(textOf(message, "en", { n: 0 })).toBe("no orders");
    expect(textOf(message, "en", { n: 1 })).toBe("1 order");
  });

  it("subtracts the offset from the category and from #", () => {
    const message = "{n, plural, offset:1 one {you and # other} other {you and # others}}";

    expect(textOf(message, "en", { n: 2 })).toBe("you and 1 other");
    expect(textOf(message, "en", { n: 4 })).toBe("you and 3 others");
  });

  it("types the plural parameter as a number", () => {
    expect(compileMessage(ORDERS_EN).params).toEqual({ n: { kind: "number" } });
  });
});

describe("selectordinal", () => {
  it("picks the ordinal categories of English", () => {
    const message = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";

    expect(textOf(message, "en", { n: 1 })).toBe("1st");
    expect(textOf(message, "en", { n: 2 })).toBe("2nd");
    expect(textOf(message, "en", { n: 3 })).toBe("3rd");
    expect(textOf(message, "en", { n: 11 })).toBe("11th");
  });
});

describe("select", () => {
  const TABS = "{id, select, audio {Звук} language {Язык} other {Вкладка}}";

  it("picks the option named by the value", () => {
    expect(textOf(TABS, "ru", { id: "audio" })).toBe("Звук");
    expect(textOf(TABS, "ru", { id: "language" })).toBe("Язык");
  });

  it("falls back to other for a value outside the options", () => {
    expect(textOf(TABS, "ru", { id: "video" })).toBe("Вкладка");
  });

  it("types the select parameter as the union of its options, without other", () => {
    expect(compileMessage(TABS).params).toEqual({
      id: { kind: "select", options: ["audio", "language"] }
    });
  });
});

describe("number, date and time styles", () => {
  it("drops the fraction for the integer style", () => {
    expect(textOf("{n, number, integer}", "en", { n: 1234.6 })).toBe("1,235");
  });

  it("formats the percent style", () => {
    expect(textOf("{n, number, percent}", "en", { n: 0.25 })).toBe("25%");
  });

  it("formats a date with the style the message named", () => {
    const day = new Date(Date.UTC(2026, 8, 22, 12));
    const expected = kitOf("en").date({ dateStyle: "long" }).format(day);

    expect(textOf("{d, date, long}", "en", { d: day })).toBe(expected);
  });

  it("formats a time with the style the message named", () => {
    const moment = new Date(Date.UTC(2026, 8, 22, 12, 30));
    const expected = kitOf("ru").date({ timeStyle: "short" }).format(moment);

    expect(textOf("{t, time, short}", "ru", { t: moment })).toBe(expected);
  });

  it("types a number as a number and a date as a date", () => {
    expect(compileMessage("{n, number, percent}").params).toEqual({ n: { kind: "number" } });
    expect(compileMessage("{d, date, full}").params).toEqual({ d: { kind: "date" } });
    expect(compileMessage("{t, time, medium}").params).toEqual({ t: { kind: "date" } });
  });
});

describe("nesting", () => {
  it("runs a plural inside a select branch", () => {
    const message =
      "{id, select, orders {{n, plural, one {# order} other {# orders}}} other {nothing}}";

    expect(textOf(message, "en", { id: "orders", n: 2 })).toBe("2 orders");
    expect(textOf(message, "en", { id: "coins", n: 2 })).toBe("nothing");
  });

  it("keeps an element inside a plural branch", () => {
    const message = "{n, plural, one {{icon} # coin} other {{icon} # coins}}";

    expect(partsOf(message, "en", { n: 2, icon: coin })).toEqual([
      { kind: "element", node: coin },
      { kind: "text", text: " 2 coins" }
    ]);
  });

  it("collects the parameters of every level", () => {
    const message =
      "{id, select, orders {{n, plural, one {# order} other {# orders}}} other {nothing}}";

    expect(compileMessage(message).params).toEqual({
      id: { kind: "select", options: ["orders"] },
      n: { kind: "number" }
    });
  });
});

describe("unsupported features", () => {
  it.each([
    ["{n, number, currency}", "currency"],
    ["{n, number, ::compact-short}", "compact-short"],
    ["{n, number, 0.00}", "0.00"],
    ["{d, date, weird}", "weird"]
  ])("refuses %s", (message, named) => {
    expect(() => compileMessage(message)).toThrow(named);
  });

  it("refuses a plural without an other branch", () => {
    expect(() => compileMessage("{n, plural, one {#}}")).toThrow(/MISSING_OTHER_CLAUSE/);
  });

  it("refuses a syntax error", () => {
    expect(() => compileMessage("{n")).toThrow(/EXPECT_ARGUMENT_CLOSING_BRACE/);
  });

  it("refuses an unknown argument type", () => {
    expect(() => compileMessage("{n, money, x}")).toThrow(/INVALID_ARGUMENT_TYPE/);
  });

  it("refuses one parameter used with two argument kinds", () => {
    expect(() => compileMessage("{n} and {n, plural, one {#} other {#}}")).toThrow(/"n"/);
  });
});

describe("tags", () => {
  it("leaves a tag as literal text for the tag pass of text", () => {
    expect(textOf("<b>{n, number}</b>", "en", { n: 7 })).toBe("<b>7</b>");
  });
});

describe("duration", () => {
  // Every literal below was checked under Bun 1.3.14 and Node 26.9: both runtimes agree on it.
  it.each([
    ["{left, duration}", "1 min, 35 sec"],
    ["{left, duration, short}", "1 min, 35 sec"],
    ["{left, duration, long}", "1 minute, 35 seconds"],
    ["{left, duration, narrow}", "1m 35s"],
    ["{left, duration, digital}", "0:01:35"]
  ])("formats 95 000 ms of %s in English", (message, expected) => {
    expect(textOf(message, "en", { left: 95_000 })).toBe(expected);
  });

  it("rounds up to whole seconds and always shows the seconds", () => {
    expect(textOf("{t, duration, long}", "en", { t: 3_605_000 })).toBe("1 hour, 5 seconds");
    expect(textOf("{t, duration, short}", "en", { t: 0 })).toBe("0 sec");
    expect(textOf("{t, duration}", "en", { t: 500 })).toBe("1 sec");
    expect(textOf("{t, duration}", "en", { t: -5 })).toBe("0 sec");
  });

  it("formats in Russian", () => {
    expect(textOf("{t, duration, short}", "ru", { t: 95_000 })).toBe("1 мин 35 с");
    expect(textOf("{t, duration, long}", "ru", { t: 95_000 })).toBe("1 минута 35 секунд");
    expect(textOf("{t, duration, short}", "ru", { t: 3_605_000 })).toBe("1 ч 5 с");
  });

  it("splits hours, minutes and seconds for Intl.DurationFormat", () => {
    // The list separator of "ru" short differs by ICU data: Bun 1.3.14 writes "2 ч, 1 мин, 35 с",
    // Node 26.9 writes "2 ч 1 мин 35 с". The split is the engine's part, so it is compared here.
    const expected = kitOf("ru")
      .duration({ style: "short", secondsDisplay: "always" })
      .format({ hours: 2, minutes: 1, seconds: 35 });

    expect(textOf("{t, duration, short}", "ru", { t: 7_295_000 })).toBe(expected);
  });

  it("compiles to the kit's formatter and the module's helper", () => {
    expect(compileMessage("{left, duration}").source).toBe(
      '(p, intl) => [{ kind: "text", text: intl.duration({ style: "short", secondsDisplay: "always" }).format(duration(p.left as number)) }]'
    );
  });

  it("types the parameter as a duration and asks for the helper only when used", () => {
    const compiled = compileMessage("Opens in {left, duration, digital}");

    expect(compiled.params).toEqual({ left: { kind: "duration" } });
    expect(compiled.usesDuration).toBe(true);
    expect(compileMessage(ORDERS_EN).usesDuration).toBe(false);
    expect(compileMessage("{n, number}").usesDuration).toBe(false);
  });

  it("nests inside a plural branch", () => {
    const message =
      "{n, plural, one {# chest opens in {left, duration}} other {# chests open in {left, duration}}}";

    expect(textOf(message, "en", { n: 2, left: 95_000 })).toBe("2 chests open in 1 min, 35 sec");
    expect(compileMessage(message).params).toEqual({
      n: { kind: "number" },
      left: { kind: "duration" }
    });
  });

  it("reads spaces around the parts of the argument", () => {
    expect(textOf("{ left , duration , narrow }", "en", { left: 95_000 })).toBe("1m 35s");
  });

  it("leaves a quoted duration as text", () => {
    expect(textOf("'{x, duration}' is the syntax", "en")).toBe("{x, duration} is the syntax");
    expect(compileMessage("'{x, duration}'").params).toEqual({});
  });

  it("still reads a duration after a literal apostrophe", () => {
    expect(textOf("it''s {t, duration}", "en", { t: 1000 })).toBe("it's 1 sec");
    expect(textOf("it's {t, duration}", "en", { t: 1000 })).toBe("it's 1 sec");
  });

  it("refuses a style it does not know", () => {
    expect(() => compileMessage("Opens in {left, duration, tiny}")).toThrow(
      'the duration style "tiny" is not supported'
    );
  });

  it("refuses one parameter used as a duration and as a number", () => {
    expect(() => compileMessage("{t, duration} or {t, number}")).toThrow(
      'the parameter "t" is used as duration and as number'
    );
  });
});
