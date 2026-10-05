import { describe, expect, it, vi } from "vitest";
import { createMockI18n, type MockI18n, moduleOf } from "./mock-i18n";

const russian = moduleOf({ "hud.orders": "3 заказа", "hud.title": "Заказы" });

const english = moduleOf({ "hud.orders": "3 orders", "hud.title": "Orders" });

const settingsRussian = moduleOf({ "settings.tab": "Звук" });

const noSingleModule = (locale: string): string =>
  `[game] Strings for "${locale}" match no single registered module.\n` +
  "  Replace them with the module of one feature, or reload the page.";

/**
 * A mock whose `hud` feature brought both locales eagerly and whose `settings` feature brought
 * Russian: locale `ru`, fallback `en`.
 *
 * @returns The started mock.
 */
async function startedMock(): Promise<MockI18n> {
  const mock = createMockI18n({ locale: "ru", fallback: "en" });

  mock.flow.features.push(
    { name: "hud", description: { strings: { ru: russian, en: english } } },
    { name: "settings", description: { strings: { ru: settingsRussian } } }
  );
  await mock.start();

  return mock;
}

describe("replace", () => {
  it("swaps the messages of an eager current locale and emits locale-changed", async () => {
    const mock = await startedMock();

    mock.api.replace("ru", moduleOf({ "hud.orders": "3 заказа!", "hud.title": "Заказы" }));

    expect(mock.api.plain({ key: "hud.orders" })).toBe("3 заказа!");
    expect(mock.api.plain({ key: "settings.tab" })).toBe("Звук");
    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "ru" } }]);
  });

  it("drops a key the new module no longer carries", async () => {
    const mock = await startedMock();

    mock.api.replace("ru", moduleOf({ "hud.orders": "3 заказа" }));

    expect(mock.api.plain({ key: "hud.title" })).toBe("Orders");
  });

  it("emits the current locale when the fallback is replaced", async () => {
    const mock = await startedMock();

    mock.api.replace("en", moduleOf({ "hud.orders": "3 orders!", "hud.title": "Orders" }));

    expect(mock.api.format({ key: "hud.orders" }, "en")).toEqual([
      { kind: "text", text: "3 orders!" }
    ]);
    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "ru" } }]);
  });

  it("replaces a lazy locale once setLocale loaded it", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: async () => ({ default: english }) } }
    });
    await mock.start();
    await mock.api.setLocale("en");
    mock.emitted.length = 0;

    mock.api.replace("en", moduleOf({ "hud.orders": "3 orders!", "hud.title": "Orders" }));

    expect(mock.api.plain({ key: "hud.orders" })).toBe("3 orders!");
    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "en" } }]);
  });

  it("does nothing for a locale not loaded yet: its loader brings the new module", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });
    const load = vi.fn(async () => english);

    mock.flow.features.push({ name: "hud", description: { strings: { ru: russian, en: load } } });
    await mock.start();

    mock.api.replace("en", moduleOf({ "hud.orders": "3 orders!" }));

    expect(load).not.toHaveBeenCalled();
    expect(mock.state.loaded.has("en")).toBe(false);
    expect(mock.emitted).toEqual([]);
  });

  it("does nothing for a locale nobody registered", async () => {
    const mock = await startedMock();

    mock.api.replace("de", moduleOf({ "hud.orders": "3 Aufträge" }));

    expect(mock.state.registered.has("de")).toBe(false);
    expect(mock.emitted).toEqual([]);
  });

  it("throws when no registered module shares a key with the new one", async () => {
    const mock = await startedMock();

    expect(() => mock.api.replace("ru", moduleOf({ "shop.title": "Магазин" }))).toThrow(
      noSingleModule("ru")
    );
    expect(mock.api.plain({ key: "hud.orders" })).toBe("3 заказа");
    expect(mock.emitted).toEqual([]);
  });

  it("throws when several registered modules share keys with the new one", async () => {
    const mock = await startedMock();

    expect(() =>
      mock.api.replace("ru", moduleOf({ "hud.orders": "3 заказа!", "settings.tab": "Звук!" }))
    ).toThrow(noSingleModule("ru"));
    expect(mock.api.plain({ key: "hud.orders" })).toBe("3 заказа");
    expect(mock.api.plain({ key: "settings.tab" })).toBe("Звук");
  });

  it("clears the keys already reported missing, so a still missing key warns again", async () => {
    const mock = await startedMock();

    mock.api.format({ key: "hud.hint" });
    mock.api.replace("ru", moduleOf({ "hud.orders": "3 заказа!", "hud.title": "Заказы" }));

    expect(mock.state.warned.size).toBe(0);

    mock.api.format({ key: "hud.hint" });

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
  });

  it("emits nothing for a locale that is neither current nor the fallback", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: english } }
    });
    await mock.start();

    mock.api.replace("en", moduleOf({ "hud.orders": "3 orders!", "hud.title": "Orders" }));

    expect(mock.api.format({ key: "hud.orders" }, "en")).toEqual([
      { kind: "text", text: "3 orders!" }
    ]);
    expect(mock.emitted).toEqual([]);
  });
});

describe("loadLocale", () => {
  it("keeps the resolved modules of a lazy locale in the registry", async () => {
    const mock = createMockI18n({ locale: "ru", fallback: "ru" });

    mock.flow.features.push({
      name: "hud",
      description: { strings: { ru: russian, en: async () => english } }
    });
    await mock.start();
    await mock.api.setLocale("en");

    expect(mock.state.registered.get("en")).toEqual([{ from: "hud", messages: english }]);
  });
});
