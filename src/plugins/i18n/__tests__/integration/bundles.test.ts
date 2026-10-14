import { describe, expect, it } from "vitest";
import { createApp, defineGame, flattenFeatures, screen, type } from "../../../../index";
import { createFakeIo } from "../../../assets/__tests__/unit/mock-assets";
import type { Manifest } from "../../../assets/types";
import { i18nFor } from "../../tr";
import type { CompiledMessage } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the screen set over a fake io, with the parent `episodes` and
// its sub-feature `ep01`, whose lazy strings live with the bundle "ep01". The
// game loads and unloads the bundle through `app.assets`; `i18n` follows it
// through the companion it handed `assets` in `onInit`.
// ---------------------------------------------------------------------------

type Strings = { "ep01.title": Record<never, never>; "home.title": Record<never, never> };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Strings;
}>();

const { tr } = i18nFor<Strings>();

/**
 * A compiled message that renders one fixed text.
 *
 * @param value - The text.
 * @returns The compiled message.
 */
function text(value: string): CompiledMessage {
  return () => [{ kind: "text", text: value }];
}

const home = defineNode({ rest: true, outcomes: { stay: type() } });

const main = defineFlow("home.main", {
  nodes: { home },
  start: "home",
  edges: { home: { stay: "home" } }
});

const homeFeature = defineFeature("home", {
  flows: [main],
  strings: { ru: { "home.title": text("Главная") }, en: { "home.title": text("Home") } }
});

const ep01Feature = defineFeature("ep01", {
  strings: {
    ru: async () => ({ default: { "ep01.title": text("Палата") } }),
    en: async () => ({ default: { "ep01.title": text("Ward") } })
  }
});

const episodesFeature = defineFeature("episodes", { features: [ep01Feature] });

const manifest: Manifest = {
  version: 1,
  bundles: {
    ep01: {
      feature: "ep01",
      parent: "episodes",
      dir: "features/episodes/ep01",
      tier: "lazy",
      mb: 0.063,
      files: [
        {
          key: "ep01.room",
          path: "features/episodes/ep01/assets/room.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    }
  }
};

/**
 * Starts the screen set with the episode game over a fake io, locale `ru`.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [...screen, ...flattenFeatures([homeFeature, episodesFeature])],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 },
      i18n: { locale: "ru", fallback: "ru" },
      assets: { manifest, io: createFakeIo() }
    }
  });

  await app.start();

  return app;
}

describe("i18n plugin integration — strings that live with a bundle", () => {
  it("brings a sub-feature's strings with its bundle, follows a switch, and drops them with the bundle", async () => {
    const app = await startApp();

    expect(app.i18n.plain(tr("ep01.title"))).toBe("⟦ep01.title⟧");
    expect(app.i18n.plain(tr("home.title"))).toBe("Главная");

    await app.assets.load("ep01");

    expect(app.i18n.plain(tr("ep01.title"))).toBe("Палата");

    await app.i18n.setLocale("en");

    expect(app.i18n.plain(tr("ep01.title"))).toBe("Ward");

    app.assets.unload("ep01");

    expect(app.i18n.plain(tr("ep01.title"))).toBe("⟦ep01.title⟧");
    expect(app.i18n.plain(tr("home.title"))).toBe("Home");

    await app.stop();
  });
});
