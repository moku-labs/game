import { describe, expect, it, vi } from "vitest";
import type { CompiledMessages, ElementNode } from "../../types";
import { createMockI18n, type MockI18n, moduleOf } from "./mock-i18n";

const coin: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

const russian = moduleOf({ "hud.orders": "3 заказа", "settings.tab": "Звук" });

const english = moduleOf({
  "hud.orders": "3 orders",
  "hud.coins": "coins",
  "settings.tab": "Audio"
});

/**
 * A mock whose `hud` feature brought both locales eagerly.
 *
 * @returns The started mock.
 */
async function startedMock(): Promise<MockI18n> {
  const mock = createMockI18n({ locale: "ru", fallback: "en" });

  mock.flow.features.push({ name: "hud", description: { strings: { ru: russian, en: english } } });
  await mock.start();

  return mock;
}

describe("locale", () => {
  it("answers the locale the config named", async () => {
    const mock = await startedMock();

    expect(mock.api.locale()).toBe("ru");
  });
});

describe("format", () => {
  it("reads the current locale", async () => {
    const mock = await startedMock();

    expect(mock.api.format({ key: "hud.orders" })).toEqual([{ kind: "text", text: "3 заказа" }]);
  });

  it("falls back for a key the current locale lacks", async () => {
    const mock = await startedMock();

    expect(mock.api.format({ key: "hud.coins" })).toEqual([{ kind: "text", text: "coins" }]);
  });

  it("shows a missing key in brackets and warns once", async () => {
    const mock = await startedMock();

    expect(mock.api.format({ key: "hud.hint" })).toEqual([{ kind: "text", text: "⟦hud.hint⟧" }]);
    mock.api.format({ key: "hud.hint" });

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("i18n: missing key", {
      key: "hud.hint",
      locale: "ru"
    });
  });

  it("merges the adjacent text parts of a compiled message", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const parts: CompiledMessages = {
      "hud.coins": () => [
        { kind: "text", text: "25" },
        { kind: "text", text: " монет" }
      ]
    };

    mock.flow.features.push({ name: "hud", description: { strings: { ru: parts } } });
    await mock.start();

    expect(mock.api.format({ key: "hud.coins" })).toEqual([{ kind: "text", text: "25 монет" }]);
  });

  it("hands the parameters and the kit of the locale to the compiled message", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const seen: Array<{ params: Record<string, unknown>; locale: string }> = [];
    const messages: CompiledMessages = {
      "hud.orders": (params, intl) => {
        seen.push({ params, locale: intl.locale });

        return [{ kind: "text", text: "ok" }];
      }
    };

    mock.flow.features.push({ name: "hud", description: { strings: { ru: messages } } });
    await mock.start();
    mock.api.format({ key: "hud.orders", params: { n: 3 } });

    expect(seen).toEqual([{ params: { n: 3 }, locale: "ru" }]);
  });

  it("reads another registered locale without switching", async () => {
    const mock = await startedMock();

    expect(mock.api.format({ key: "hud.orders" }, "en")).toEqual([
      { kind: "text", text: "3 orders" }
    ]);
    expect(mock.api.locale()).toBe("ru");
  });

  it("refuses a locale that is registered but not loaded", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: async () => english } }
    });
    await mock.start();

    expect(() => mock.api.format({ key: "hud.orders" }, "en")).toThrow(
      '[game] Locale "en" is not loaded.\n  Await setLocale("en") once, or register it eagerly.'
    );
  });

  it("refuses a locale nobody registered", async () => {
    const mock = await startedMock();

    expect(() => mock.api.format({ key: "hud.orders" }, "de")).toThrow(
      '[game] Locale "de" is not registered.\n' +
        "  Add it to pluginConfigs.i18n.locales or the feature strings."
    );
  });
});

describe("plain", () => {
  it("joins the text parts and drops the elements", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const messages: CompiledMessages = {
      "hud.coins": () => [
        { kind: "element", node: coin },
        { kind: "text", text: " 25" }
      ]
    };

    mock.flow.features.push({ name: "hud", description: { strings: { ru: messages } } });
    await mock.start();

    expect(mock.api.plain({ key: "hud.coins" })).toBe(" 25");
  });

  it("shows a missing key in brackets", async () => {
    const mock = await startedMock();

    expect(mock.api.plain({ key: "hud.hint" })).toBe("⟦hud.hint⟧");
  });
});

describe("has", () => {
  it("answers true for a key of the current locale and of the fallback", async () => {
    const mock = await startedMock();

    expect(mock.api.has("hud.orders")).toBe(true);
    expect(mock.api.has("hud.coins")).toBe(true);
  });

  it("answers false for a key neither locale has", async () => {
    const mock = await startedMock();

    expect(mock.api.has("hud.hint")).toBe(false);
  });
});

describe("locales", () => {
  it("lists the locales of the features and of the config, sorted", async () => {
    const mock = createMockI18n({
      locale: "ru",
      fallback: "ru",
      locales: { de: moduleOf({ "hud.orders": "3 Aufträge" }) }
    });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: english } }
    });
    await mock.start();

    expect(mock.api.locales()).toEqual(["de", "en", "ru"]);
  });
});

describe("setLocale", () => {
  it("awaits a lazy module once, then emits", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const load = vi.fn(async () => ({ default: english }));

    mock.flow.features.push({ name: "hud", description: { strings: { ru: russian, en: load } } });
    await mock.start();

    expect(load).not.toHaveBeenCalled();

    await mock.api.setLocale("en");

    expect(mock.api.locale()).toBe("en");
    expect(mock.api.format({ key: "hud.orders" })).toEqual([{ kind: "text", text: "3 orders" }]);
    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "en" } }]);

    await mock.api.setLocale("ru");
    await mock.api.setLocale("en");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("emits nothing at start", async () => {
    const mock = await startedMock();

    expect(mock.emitted).toEqual([]);
  });

  it("resolves at once for the locale already current", async () => {
    const mock = await startedMock();

    await mock.api.setLocale("ru");

    expect(mock.emitted).toEqual([]);
  });

  it("throws for an unknown locale before any load runs", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const load = vi.fn(async () => english);

    mock.flow.features.push({ name: "hud", description: { strings: { ru: russian, en: load } } });
    await mock.start();

    await expect(mock.api.setLocale("de")).rejects.toThrow(
      '[game] Locale "de" is not registered.\n' +
        "  Add it to pluginConfigs.i18n.locales or the feature strings."
    );
    expect(load).not.toHaveBeenCalled();
    expect(mock.api.locale()).toBe("ru");
  });

  it("keeps the locale when the loader rejects", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: {
        strings: {
          ru: russian,
          en: async () => {
            throw new Error("offline");
          }
        }
      }
    });
    await mock.start();

    await expect(mock.api.setLocale("en")).rejects.toThrow("offline");
    expect(mock.api.locale()).toBe("ru");
    expect(mock.emitted).toEqual([]);
  });

  it("lets the last of two calls in flight win", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const release: Array<() => void> = [];
    const gate = (messages: CompiledMessages) => async () => {
      await new Promise<void>(resolve => release.push(resolve));

      return messages;
    };

    mock.flow.features.push({
      name: "hud",
      description: {
        strings: { ru: russian, en: gate(english), de: gate(moduleOf({ "hud.orders": "3" })) }
      }
    });
    await mock.start();

    const releaseNext = async (): Promise<void> => {
      for (let tries = 0; release.length === 0 && tries < 100; tries += 1) await Promise.resolve();

      for (const resolve of release.splice(0)) resolve();
    };

    const first = mock.api.setLocale("en");
    const second = mock.api.setLocale("de");

    await releaseNext();
    await first;
    await releaseNext();
    await second;

    expect(mock.api.locale()).toBe("de");
    expect(mock.emitted.map(entry => entry.payload)).toEqual([{ locale: "en" }, { locale: "de" }]);
  });
});
