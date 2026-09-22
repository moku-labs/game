import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, type } from "../../../../index";
import { i18nPlugin } from "../../index";
import { i18nFor } from "../../tr";
import type { CompiledMessages, ElementNode, Events } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock and flow plugins plus
// `i18n`, in plain Bun. Two features bring compiled modules the way the build
// writes them — one eager pair, one lazy English module — and a probe plugin
// hears the event a locale change sends.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { visits: number };

type Strings = {
  "hud.coins": { icon: ElementNode; n: number };
  "hud.orders": { n: number };
  "orders.complete": Record<never, never>;
};

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Strings;
}>();

const { tr } = i18nFor<Strings>();

const coin: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

const hudRussian: CompiledMessages = {
  "hud.orders": (p, intl) => [
    { kind: "text", text: `${intl.number().format(Number(p.n))} заказа` }
  ],
  "hud.coins": (p, intl) => [
    { kind: "element", node: { type: "icon", props: {}, children: [] } },
    { kind: "text", text: ` ${intl.number().format(Number(p.n))}` }
  ]
};

const hudEnglish: CompiledMessages = {
  "hud.orders": (p, intl) => [
    { kind: "text", text: `${intl.number().format(Number(p.n))} orders` }
  ],
  "hud.coins": (p, intl) => [
    { kind: "element", node: { type: "icon", props: {}, children: [] } },
    { kind: "text", text: ` ${intl.number().format(Number(p.n))}` }
  ]
};

const ordersRussian: CompiledMessages = {
  "orders.complete": () => [{ kind: "text", text: "Заказ собран" }]
};

const home = defineNode({ rest: true, checkpoint: true, outcomes: { play: type() } });

const away = defineNode({ rest: true, outcomes: { back: type() } });

const main = defineFlow("main", {
  nodes: { home, away },
  start: "home",
  edges: { home: { play: "away" }, away: { back: "home" } }
});

const hudFeature = defineFeature("hud", {
  strings: { ru: hudRussian, en: async () => ({ default: hudEnglish }) }
});

const ordersFeature = defineFeature("orders", { flows: [main], strings: { ru: ordersRussian } });

/** Every `i18n:locale-changed` the probe plugin heard, in order. */
const heard: Events["i18n:locale-changed"][] = [];

const probePlugin = createPlugin("i18nProbe", {
  depends: [i18nPlugin],
  hooks: () => ({
    "i18n:locale-changed": (payload: Events["i18n:locale-changed"]) => {
      heard.push(payload);
    }
  })
});

/**
 * Starts the logic set plus `i18n` headless.
 *
 * @returns The started app.
 */
async function startApp() {
  heard.length = 0;

  const app = createApp({
    plugins: [i18nPlugin, hudFeature, ordersFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "ru", fallback: "ru" },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  await app.start();

  return app;
}

describe("i18n plugin integration — a live locale change", () => {
  it("formats in the start locale, from the merged modules of both features", async () => {
    const app = await startApp();

    expect(app.i18n.locale()).toBe("ru");
    expect(app.i18n.locales()).toEqual(["en", "ru"]);
    expect(app.i18n.plain(tr("hud.orders", { n: 3 }))).toBe("3 заказа");
    expect(app.i18n.plain(tr("orders.complete"))).toBe("Заказ собран");
    expect(heard).toEqual([]);

    await app.stop();
  });

  it("keeps an element parameter as an element part", async () => {
    const app = await startApp();

    expect(app.i18n.format(tr("hud.coins", { n: 25, icon: coin }))).toEqual([
      { kind: "element", node: { type: "icon", props: {}, children: [] } },
      { kind: "text", text: " 25" }
    ]);

    await app.stop();
  });

  it("loads the lazy module on setLocale and tells the plugins above", async () => {
    const app = await startApp();

    await app.i18n.setLocale("en");

    expect(app.i18n.locale()).toBe("en");
    expect(app.i18n.plain(tr("hud.orders", { n: 3 }))).toBe("3 orders");
    expect(heard).toEqual([{ locale: "en" }]);

    await app.stop();
  });

  it("falls back to the start locale for a key the new locale lacks", async () => {
    const app = await startApp();

    await app.i18n.setLocale("en");

    expect(app.i18n.plain(tr("orders.complete"))).toBe("Заказ собран");

    await app.stop();
  });

  it("refuses a locale no feature brought", async () => {
    const app = await startApp();

    await expect(app.i18n.setLocale("de")).rejects.toThrow(
      '[game] Locale "de" is not registered.\n' +
        "  Add it to pluginConfigs.i18n.locales or the feature strings."
    );

    await app.stop();
  });
});
