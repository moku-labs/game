import { describe, expect, it } from "vitest";
import { isElement, mergeLocales, mergeParts, missingParts, resolve } from "../../messages";
import { createI18nState } from "../../state";
import type { ElementNode, Part } from "../../types";
import { moduleOf } from "./mock-i18n";

describe("mergeLocales", () => {
  it("merges the modules of two features into one table", () => {
    const merged = mergeLocales([
      { from: "hud", messages: moduleOf({ "hud.orders": "заказы" }) },
      { from: "orders", messages: moduleOf({ "orders.coins": "монеты" }) }
    ]);

    expect(Object.keys(merged).toSorted()).toEqual(["hud.orders", "orders.coins"]);
  });

  it("names both features when they carry the same key", () => {
    expect(() =>
      mergeLocales([
        { from: "hud", messages: moduleOf({ "hud.orders": "заказы" }) },
        { from: "orders", messages: moduleOf({ "hud.orders": "заказы" }) }
      ])
    ).toThrow(
      '[game] i18n: key "hud.orders" is defined by features "hud" and "orders".\n' +
        "  Keep it in one feature."
    );
  });

  it("merges an empty list into an empty table", () => {
    expect(mergeLocales([])).toEqual({});
  });
});

describe("resolve", () => {
  it("reads the current locale first", () => {
    const state = createI18nState();
    const russian = moduleOf({ "hud.orders": "заказы" });

    state.loaded.set("ru", russian);
    state.loaded.set("en", moduleOf({ "hud.orders": "orders" }));

    expect(resolve(state, "hud.orders", "ru", "en")).toBe(russian["hud.orders"]);
  });

  it("falls back to the fallback locale for a key the current locale lacks", () => {
    const state = createI18nState();
    const english = moduleOf({ "hud.coins": "coins" });

    state.loaded.set("ru", moduleOf({ "hud.orders": "заказы" }));
    state.loaded.set("en", english);

    expect(resolve(state, "hud.coins", "ru", "en")).toBe(english["hud.coins"]);
  });

  it("answers undefined when neither locale has the key", () => {
    const state = createI18nState();

    state.loaded.set("ru", moduleOf({ "hud.orders": "заказы" }));

    expect(resolve(state, "hud.hint", "ru", "en")).toBeUndefined();
  });

  it("answers undefined when the locale was never loaded", () => {
    expect(resolve(createI18nState(), "hud.orders", "ru", "en")).toBeUndefined();
  });
});

describe("missingParts", () => {
  it("shows the key in brackets", () => {
    expect(missingParts("hud.hint")).toEqual([{ kind: "text", text: "⟦hud.hint⟧" }]);
  });
});

describe("isElement", () => {
  it("accepts an object with type, props and children", () => {
    const node: ElementNode = { type: "icon", props: {}, children: [] };

    expect(isElement(node)).toBe(true);
  });

  it.each([["text"], [3], [undefined], [["a", "b"]], [{ type: "icon" }]])("refuses %s", value => {
    expect(isElement(value)).toBe(false);
  });

  it("refuses an empty value", () => {
    const nothing: unknown = JSON.parse("null");

    expect(isElement(nothing)).toBe(false);
  });
});

describe("mergeParts", () => {
  const node: ElementNode = { type: "icon", props: {}, children: [] };

  it("merges adjacent text parts into one", () => {
    const parts: Part[] = [
      { kind: "text", text: "3" },
      { kind: "text", text: " заказа" }
    ];

    expect(mergeParts(parts)).toEqual([{ kind: "text", text: "3 заказа" }]);
  });

  it("keeps an element between two text runs", () => {
    const parts: Part[] = [
      { kind: "text", text: "Награда: " },
      { kind: "element", node },
      { kind: "text", text: " " },
      { kind: "text", text: "25" }
    ];

    expect(mergeParts(parts)).toEqual([
      { kind: "text", text: "Награда: " },
      { kind: "element", node },
      { kind: "text", text: " 25" }
    ]);
  });

  it("leaves an empty list empty", () => {
    expect(mergeParts([])).toEqual([]);
  });
});
