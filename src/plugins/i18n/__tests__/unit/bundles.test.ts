import { describe, expect, it, vi } from "vitest";
import type { FeatureDescription } from "../../../flow/features/types";
import type { CompiledMessages } from "../../types";
import { type AssetsSetup, createMockI18n, type MockI18n, moduleOf } from "./mock-i18n";

// ---------------------------------------------------------------------------
// The strings that live with a bundle: the lazy modules of a sub-feature load
// and unload with the bundle named like it. `ep01` is a sub-feature of
// `episodes`; `hud` is a top-level feature that brought both locales eagerly.
// ---------------------------------------------------------------------------

const hudRussian = moduleOf({ "hud.title": "Заказы" });
const hudEnglish = moduleOf({ "hud.title": "Orders" });
const wardRussian = moduleOf({ "ep01.title": "Палата" });
const wardEnglish = moduleOf({ "ep01.title": "Ward" });

/** What a feature registers under `strings`: a module or a loader per locale. */
type FeatureStrings = NonNullable<FeatureDescription["strings"]>;

const NOT_LOADED = "i18n: the bundle of a key is not loaded";

/** A manifest with the bundle `ep01`, not loaded. */
const EP01_BUNDLE: AssetsSetup = { bundles: ["ep01"] };

const noSingleModule = (locale: string): string =>
  `[game] Strings for "${locale}" match no single registered module.\n` +
  "  Replace them with the module of one feature, or reload the page.";

/**
 * A loader that resolves with a module namespace, the way `() => import(…)` does.
 *
 * @param messages - The module the loader brings.
 * @returns The loader, as a spy.
 */
function lazy(messages: CompiledMessages) {
  return vi.fn(async () => ({ default: messages }));
}

/**
 * A loader that waits until the test opens it.
 *
 * @param messages - The module the loader brings once opened.
 * @returns The loader and the switch that lets it resolve.
 */
function gated(messages: CompiledMessages) {
  const gate = { open: (): void => undefined };
  const load = vi.fn(
    () =>
      new Promise<CompiledMessages>(resolve => {
        gate.open = () => resolve(messages);
      })
  );

  return { load, gate };
}

/**
 * Yields the microtask queue, so a queued strings load reaches its loader.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/**
 * The game of most tests: `hud` with both locales eagerly, the parent `episodes`, and its
 * sub-feature `ep01` with the strings the test gives. Locale `ru`, fallback `en`.
 *
 * @param strings - What `ep01` registers.
 * @param assets - The fake `assets`, or `false` for an app without it; by default a manifest
 *   with the bundle `ep01`, not loaded.
 * @returns The mock, not started.
 */
function episodeGame(strings: FeatureStrings, assets: AssetsSetup | false = EP01_BUNDLE): MockI18n {
  const mock = createMockI18n(
    { locale: "ru", fallback: "en" },
    assets === false ? undefined : assets
  );

  mock.flow.features.push(
    { name: "hud", description: { strings: { ru: hudRussian, en: hudEnglish } } },
    { name: "episodes", description: {} },
    { name: "ep01", parent: "episodes", description: { strings } }
  );

  return mock;
}

/**
 * A game whose `hud` brings English lazily, so English is not loaded until a switch. Locale and
 * fallback `ru`.
 *
 * @param strings - What `ep01` registers.
 * @param english - The loader of `hud`'s English.
 * @returns The mock, not started.
 */
function lazyEnglishGame(
  strings: FeatureStrings,
  english: () => Promise<unknown> = lazy(hudEnglish)
): MockI18n {
  const mock = createMockI18n({ locale: "ru", fallback: "ru" }, { bundles: ["ep01"] });

  mock.flow.features.push(
    { name: "hud", description: { strings: { ru: hudRussian, en: english } } },
    { name: "episodes", description: {} },
    { name: "ep01", parent: "episodes", description: { strings } }
  );

  return mock;
}

describe("connectI18n", () => {
  it("hands assets one companion when assets is composed", () => {
    const mock = createMockI18n({}, { bundles: ["ep01"] });

    expect(mock.assets?.companions).toHaveLength(1);
  });

  it("without assets adds nothing and imports a sub-feature's lazy module with its locale", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian }, false);

    await mock.start();

    expect(mock.assets).toBeUndefined();
    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });
});

describe("which lazy modules live with a bundle", () => {
  it("leaves a sub-feature's module out while its bundle is not loaded, and names the bundle once", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await mock.start();

    expect(loadRussian).not.toHaveBeenCalled();
    expect(mock.api.format({ key: "ep01.title" })).toEqual([
      { kind: "text", text: "⟦ep01.title⟧" }
    ]);

    mock.api.format({ key: "ep01.title" });

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith(NOT_LOADED, {
      key: "ep01.title",
      bundle: "ep01",
      locale: "ru"
    });
    expect(mock.api.has("ep01.title")).toBe(false);
  });

  it("imports a top-level feature's lazy module at start, whatever bundle has its name", async () => {
    const loadRussian = lazy(hudRussian);
    const mock = createMockI18n({ locale: "ru", fallback: "ru" }, { bundles: ["hud"] });

    mock.flow.features.push({ name: "hud", description: { strings: { ru: loadRussian } } });
    await mock.start();

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "hud.title" })).toBe("Заказы");
  });

  it("imports a sub-feature's lazy module at start when the manifest has no bundle of its name", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian }, { bundles: [] });

    await mock.start();

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("ties a strings-only sub-feature to its file-less bundle", async () => {
    const loadRussian = lazy(moduleOf({ "kit.hint": "Подсказка" }));
    const mock = createMockI18n({ locale: "ru", fallback: "ru" }, { bundles: ["kit"] });

    mock.flow.features.push(
      { name: "episodes", description: {} },
      { name: "kit", parent: "episodes", description: { strings: { ru: loadRussian } } }
    );
    await mock.start();

    expect(loadRussian).not.toHaveBeenCalled();

    await mock.companion().load("kit");

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "kit.hint" })).toBe("Подсказка");
  });

  it("merges a sub-feature's eager table at start", async () => {
    const mock = episodeGame({ ru: wardRussian });

    await mock.start();

    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("imports a bundle assets already holds at start, with the start locale and the fallback", async () => {
    const loadRussian = lazy(wardRussian);
    const loadEnglish = lazy(wardEnglish);
    const mock = episodeGame(
      { ru: loadRussian, en: loadEnglish },
      { bundles: ["ep01"], loaded: ["ep01"] }
    );

    await mock.start();

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(loadEnglish).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("never calls a held bundle not loaded, also when it brought nothing for the loaded locales", async () => {
    const mock = episodeGame(
      { de: lazy(moduleOf({ "ep01.title": "Station" })) },
      { bundles: ["ep01"], loaded: ["ep01"] }
    );

    await mock.start();
    mock.api.format({ key: "ep01.title" });

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith("i18n: missing key", {
      key: "ep01.title",
      locale: "ru"
    });
  });
});

describe("the companion load", () => {
  it("imports the bundle's module for every loaded locale and resolves after the merge", async () => {
    const loaders = {
      ru: lazy(wardRussian),
      en: lazy(wardEnglish),
      de: lazy(moduleOf({ "ep01.title": "Station" }))
    };
    const mock = createMockI18n({ locale: "ru", fallback: "en" }, { bundles: ["ep01"] });

    mock.flow.features.push(
      {
        name: "hud",
        description: {
          strings: { ru: hudRussian, en: hudEnglish, de: moduleOf({ "hud.title": "Aufträge" }) }
        }
      },
      { name: "episodes", description: {} },
      { name: "ep01", parent: "episodes", description: { strings: loaders } }
    );
    await mock.start();
    await mock.companion().load("ep01");

    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
    expect(mock.api.format({ key: "ep01.title" }, "en")).toEqual([{ kind: "text", text: "Ward" }]);
    expect(mock.api.format({ key: "ep01.title" }, "de")).toEqual([
      { kind: "text", text: "Station" }
    ]);
    expect(loaders.ru).toHaveBeenCalledTimes(1);
    expect(loaders.en).toHaveBeenCalledTimes(1);
    expect(loaders.de).toHaveBeenCalledTimes(1);
  });

  it("resolves at once for a bundle without strings, also while a locale switch waits", async () => {
    const english = gated(hudEnglish);
    const loadWard = lazy(wardRussian);
    const mock = lazyEnglishGame({ ru: loadWard }, english.load);

    await mock.start();

    const switching = mock.api.setLocale("en");

    await expect(mock.companion().load("board")).resolves.toBeUndefined();
    expect(loadWard).not.toHaveBeenCalled();

    await flush();
    english.gate.open();
    await switching;
  });

  it("drops only the bundle's keys on unload, emits nothing, and imports again on the next load", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await mock.start();
    await mock.companion().load("ep01");
    mock.companion().unload("ep01");

    expect(mock.api.plain({ key: "ep01.title" })).toBe("⟦ep01.title⟧");
    expect(mock.api.plain({ key: "hud.title" })).toBe("Заказы");
    expect(mock.emitted).toEqual([]);

    await mock.companion().load("ep01");

    expect(loadRussian).toHaveBeenCalledTimes(2);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("drops the module of a load the unload overtook", async () => {
    const russian = gated(wardRussian);
    const mock = episodeGame({ ru: russian.load });

    await mock.start();

    const loading = mock.companion().load("ep01");

    await flush();
    expect(russian.load).toHaveBeenCalledTimes(1);

    mock.companion().unload("ep01");
    russian.gate.open();
    await loading;

    expect(mock.api.plain({ key: "ep01.title" })).toBe("⟦ep01.title⟧");
  });

  it("rejects with the loader's error, keeps the bundle out, and runs the loader again on the next load", async () => {
    const broken = new Error("chunk failed");
    const loadRussian = vi
      .fn<() => Promise<CompiledMessages>>()
      .mockRejectedValueOnce(broken)
      .mockResolvedValue(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await mock.start();

    await expect(mock.companion().load("ep01")).rejects.toBe(broken);

    mock.api.format({ key: "ep01.title" });

    expect(mock.log.warn).toHaveBeenCalledWith(NOT_LOADED, {
      key: "ep01.title",
      bundle: "ep01",
      locale: "ru"
    });

    await mock.companion().load("ep01");

    expect(loadRussian).toHaveBeenCalledTimes(2);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("rejects a module that repeats another feature's key and leaves every locale as it was", async () => {
    const mock = episodeGame({
      ru: lazy(moduleOf({ "ep01.title": "Палата", "hud.title": "Заказы" }))
    });

    await mock.start();

    const before = new Map(mock.state.loaded);

    await expect(mock.companion().load("ep01")).rejects.toThrow(
      '[game] i18n: key "hud.title" is defined by features "hud" and "ep01".\n' +
        "  Keep it in one feature."
    );

    for (const [locale, table] of before) expect(mock.state.loaded.get(locale)).toBe(table);
    expect(mock.api.has("ep01.title")).toBe(false);
  });
});

describe("a locale switch with bundles", () => {
  it("imports a loaded bundle's module of the new locale before the event", async () => {
    const loadEnglish = lazy(wardEnglish);
    const mock = lazyEnglishGame({ ru: lazy(wardRussian), en: loadEnglish });
    const seen: string[] = [];

    await mock.start();
    await mock.companion().load("ep01");

    expect(loadEnglish).not.toHaveBeenCalled();

    mock.onEmit = () => {
      seen.push(mock.api.plain({ key: "ep01.title" }));
    };
    await mock.api.setLocale("en");

    expect(seen).toEqual(["Ward"]);
  });

  it("leaves the module of a bundle that is not loaded alone", async () => {
    const loadEnglish = lazy(wardEnglish);
    const mock = lazyEnglishGame({ ru: lazy(wardRussian), en: loadEnglish });

    await mock.start();
    await mock.api.setLocale("en");

    expect(loadEnglish).not.toHaveBeenCalled();
  });

  it("gives the new locale the bundle's keys when the bundle loads during the switch", async () => {
    const english = gated(hudEnglish);
    const mock = createMockI18n({ locale: "ru", fallback: "ru" }, { bundles: ["ep01"] });

    // ep01 registers before hud, so the switch passes its entry before the bundle is held.
    mock.flow.features.push(
      { name: "episodes", description: {} },
      {
        name: "ep01",
        parent: "episodes",
        description: { strings: { ru: lazy(wardRussian), en: lazy(wardEnglish) } }
      },
      { name: "hud", description: { strings: { ru: hudRussian, en: english.load } } }
    );
    await mock.start();

    const switching = mock.api.setLocale("en");

    await flush();

    const loading = mock.companion().load("ep01");

    english.gate.open();
    await Promise.all([switching, loading]);

    expect(mock.api.plain({ key: "ep01.title" })).toBe("Ward");
    expect(mock.api.format({ key: "ep01.title" }, "ru")).toEqual([
      { kind: "text", text: "Палата" }
    ]);
  });
});

describe("before start", () => {
  it("records a load, imports its strings with the start locale, and keeps only coupled bundles", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await expect(mock.companion().load("ep01")).resolves.toBeUndefined();
    await mock.companion().load("board");

    expect(loadRussian).not.toHaveBeenCalled();

    await mock.start();

    expect(loadRussian).toHaveBeenCalledTimes(1);
    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
    expect([...mock.state.held.keys()]).toEqual(["ep01"]);
  });

  it("cancels a load with an unload", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await mock.companion().load("ep01");
    mock.companion().unload("ep01");
    await mock.start();

    expect(loadRussian).not.toHaveBeenCalled();
  });
});

describe("a key shown missing", () => {
  it("tells text once when a load brings it, and warns again after the unload", async () => {
    const mock = episodeGame({ ru: lazy(wardRussian) });

    await mock.start();
    mock.api.format({ key: "ep01.title" });
    await mock.companion().load("ep01");

    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "ru" } }]);

    mock.companion().unload("ep01");
    mock.api.format({ key: "ep01.title" });

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
  });

  it("emits nothing for a load that brings no key shown missing", async () => {
    const mock = episodeGame({ ru: lazy(wardRussian) });

    await mock.start();
    mock.api.format({ key: "hud.hint" });
    await mock.companion().load("ep01");

    expect(mock.emitted).toEqual([]);
  });
});

describe("replace with bundles", () => {
  it("swaps the module of a loaded bundle and emits", async () => {
    const mock = episodeGame({ ru: lazy(wardRussian) });

    await mock.start();
    await mock.companion().load("ep01");
    mock.api.replace("ru", moduleOf({ "ep01.title": "Палата!" }));

    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата!");
    expect(mock.emitted).toEqual([{ name: "i18n:locale-changed", payload: { locale: "ru" } }]);
  });

  it("leaves the module of a bundle that is not loaded alone, without throwing", async () => {
    const loadRussian = lazy(wardRussian);
    const mock = episodeGame({ ru: loadRussian });

    await mock.start();
    mock.api.replace("ru", moduleOf({ "ep01.title": "Палата!" }));

    expect(loadRussian).not.toHaveBeenCalled();
    expect(mock.emitted).toEqual([]);

    await mock.companion().load("ep01");

    expect(mock.api.plain({ key: "ep01.title" })).toBe("Палата");
  });

  it("still refuses a module whose keys are not all of one bundle that is not loaded", async () => {
    const mock = episodeGame({ ru: lazy(wardRussian) });

    await mock.start();

    expect(() =>
      mock.api.replace("ru", moduleOf({ "ep01.title": "Палата!", "shop.title": "Магазин" }))
    ).toThrow(noSingleModule("ru"));
  });
});
