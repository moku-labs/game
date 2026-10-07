/**
 * @file `resolveConfig`: the defaults of `config.ts`, and the three values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`.
 */
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import type { GameConfig } from "../../../src/app/types";

describe("resolveConfig", () => {
  it("fills every default of a config with a title only", () => {
    expect(resolveConfig({ page: { title: "T" } })).toEqual({
      page: {
        title: "T",
        lang: "en",
        background: "#000000",
        orientation: "portrait",
        icons: {},
        head: []
      },
      native: undefined,
      system: [],
      save: "memory",
      assets: { layers: {} }
    });
  });

  it("keeps every value the config sets", () => {
    const config = {
      page: {
        title: "Лесной городок",
        lang: "ru",
        background: "#10161d",
        orientation: "landscape",
        icons: { favicon: "assets/icon.png", appleTouch: "assets/icon-180.png" },
        head: ['<meta name="robots" content="noindex" />']
      },
      native: { name: "Лесной городок", identifier: "com.mokulabs.timber", targets: ["ios"] },
      system: ["lifecycle", "back", "haptics", "keepAwake"],
      save: "local",
      assets: { layers: { shared: "ui" } }
    } satisfies GameConfig;

    expect(resolveConfig(config)).toEqual({ ...config, assets: { layers: { shared: "ui" } } });
  });

  it("does not share the default lists between two configs", () => {
    const first = resolveConfig({ page: { title: "A" } });
    const second = resolveConfig({ page: { title: "B" } });

    expect(first.system).not.toBe(second.system);
    expect(first.page.head).not.toBe(second.page.head);
  });

  it("refuses a save kind it does not know", () => {
    const config = { page: { title: "T" }, save: "disk" } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error('[game] config.save is "disk".\n  Use "memory", "local" or "store".')
    );
  });

  it("refuses a system name the game shell does not wire", () => {
    const config = { page: { title: "T" }, system: ["back", "tray"] } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error(
        '[game] config.system names "tray", which the game shell does not wire.\n  Use lifecycle, back, haptics, keepAwake or store.'
      )
    );
  });

  it("refuses an empty page title", () => {
    expect(() => resolveConfig({ page: { title: "" } })).toThrow(
      new Error("[game] config.page.title is empty.\n  Give the page a title in config.ts.")
    );
    expect(() => resolveConfig({ page: { title: "  " } })).toThrow(
      "[game] config.page.title is empty."
    );
  });
});
