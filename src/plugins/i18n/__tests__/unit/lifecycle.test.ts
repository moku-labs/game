import { describe, expect, it, vi } from "vitest";
import { createMockI18n, moduleOf } from "./mock-i18n";

const russian = moduleOf({ "hud.orders": "3 заказа" });

const english = moduleOf({ "hud.orders": "3 orders" });

describe("startI18n", () => {
  it("collects the modules of every feature and of the config", async () => {
    const mock = createMockI18n({
      locale: "ru",
      fallback: "en",
      locales: { de: moduleOf({ "hud.orders": "3 Aufträge" }) }
    });

    mock.flow.features.push(
      { name: "hud", description: { strings: { ru: russian } } },
      {
        name: "orders",
        description: { strings: { ru: moduleOf({ "orders.coins": "монеты" }), en: english } }
      }
    );
    await mock.start();

    expect([...mock.state.registered.keys()].toSorted()).toEqual(["de", "en", "ru"]);
    expect(mock.state.registered.get("ru")?.map(entry => entry.from)).toEqual(["hud", "orders"]);
    expect(mock.state.registered.get("de")?.map(entry => entry.from)).toEqual([
      "pluginConfigs.i18n"
    ]);
  });

  it("skips a feature that brought no strings", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push(
      { name: "board", description: {} },
      { name: "hud", description: { strings: { ru: russian } } }
    );
    await mock.start();

    expect(mock.state.registered.get("ru")?.map(entry => entry.from)).toEqual(["hud"]);
  });

  it("merges every eager locale, so format never waits", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "en" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: english } }
    });
    await mock.start();

    expect([...mock.state.loaded.keys()].toSorted()).toEqual(["en", "ru"]);
    expect(mock.state.locale).toBe("ru");
  });

  it("names both features when they carry the same key", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push(
      { name: "hud", description: { strings: { ru: russian } } },
      { name: "orders", description: { strings: { ru: russian } } }
    );

    await expect(mock.start()).rejects.toThrow(
      '[game] i18n: key "hud.orders" is defined by features "hud" and "orders".\n' +
        "  Keep it in one feature."
    );
  });

  it("awaits a lazy start locale and a lazy fallback", async () => {
    const loadRussian = vi.fn(async () => ({ default: russian }));
    const loadEnglish = vi.fn(async () => english);
    const mock = createMockI18n({ locale: "ru", fallback: "en" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: loadRussian, en: loadEnglish } }
    });
    await mock.start();

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(loadEnglish).toHaveBeenCalledTimes(1);
    expect(mock.api.format({ key: "hud.orders" })).toEqual([{ kind: "text", text: "3 заказа" }]);
  });

  it("leaves a lazy locale nobody asked for unloaded", async () => {
    const loadGerman = vi.fn(async () => moduleOf({ "hud.orders": "3 Aufträge" }));
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, de: loadGerman } }
    });
    await mock.start();

    expect(loadGerman).not.toHaveBeenCalled();
    expect(mock.state.loaded.has("de")).toBe(false);
  });

  it("throws the registration message for an unknown start locale", async () => {
    const mock = createMockI18n({ locale: "de", fallback: "en" });

    mock.flow.features.push({ name: "hud", description: { strings: { ru: russian } } });

    await expect(mock.start()).rejects.toThrow(
      '[game] Locale "de" is not registered.\n' +
        "  Add it to pluginConfigs.i18n.locales or the feature strings."
    );
  });

  it("starts a game that brought no strings at all", async () => {
    const mock = createMockI18n({ locale: "en", fallback: "en" });

    await mock.start();

    expect(mock.api.locales()).toEqual([]);
    expect(mock.api.plain({ key: "hud.orders" })).toBe("⟦hud.orders⟧");
  });
});

describe("createI18nState", () => {
  it("starts with nothing registered, nothing loaded and no load in flight", () => {
    const mock = createMockI18n();

    expect(mock.state.locale).toBe("");
    expect(mock.state.registered.size).toBe(0);
    expect(mock.state.loaded.size).toBe(0);
    expect(mock.state.intl.size).toBe(0);
    expect(mock.state.warned.size).toBe(0);
    expect(mock.state.loading).toBeUndefined();
  });
});
