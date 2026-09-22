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
