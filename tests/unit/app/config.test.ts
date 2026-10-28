/**
 * @file `resolveConfig`: the defaults of `config.ts`, and the three values TypeScript cannot stop
 * in a file that skips `satisfies GameConfig`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
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
      assets: { layers: {} },
      debug: { overlay: "closed" }
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
      assets: { layers: { shared: "ui" } },
      debug: { overlay: "pill" }
    } satisfies GameConfig;

    expect(resolveConfig(config)).toEqual({ ...config, assets: { layers: { shared: "ui" } } });
  });

  it("debug.overlay defaults to closed; pill and open pass; another value throws naming it", () => {
    expect(resolveConfig({ page: { title: "T" }, debug: {} }).debug).toEqual({ overlay: "closed" });
    expect(resolveConfig({ page: { title: "T" }, debug: { overlay: "open" } }).debug).toEqual({
      overlay: "open"
    });

    const config = { page: { title: "T" }, debug: { overlay: "card" } } as unknown as GameConfig;

    expect(() => resolveConfig(config)).toThrow(
      new Error('[game] config.ts: debug.overlay must be "closed", "pill" or "open", got "card".')
    );
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

  // Bug: a boot without a width or a fade gives the page "undefined" in its style.
  it("page.boot fills width 40vmin and fadeMs 300, and keeps a value the config sets", () => {
    expect(
      resolveConfig({ page: { title: "T", boot: { image: "assets/boot.png" } } }).page.boot
    ).toEqual({ image: "assets/boot.png", width: "40vmin", fadeMs: 300 });

    const boot = { image: "assets/boot.png", width: "52vmin", fadeMs: 0 };

    expect(resolveConfig({ page: { title: "T", boot } }).page.boot).toEqual(boot);
  });

  // Bug: a page with no boot gets a default picture, or a `boot: undefined` key a shell's fake config lacks.
  it("a page without page.boot resolves with no boot key", () => {
    expect("boot" in resolveConfig({ page: { title: "T" } }).page).toBe(false);
  });

  // Bug: a config.ts that skips `satisfies` writes a boot with no picture and the page throws a bare TypeError.
  it("refuses a page.boot with no image", () => {
    const boot = {} as { image: string };

    expect(() => resolveConfig({ page: { title: "T", boot } })).toThrow(
      new Error(
        "[game] config.page.boot has no image.\n  Name a picture file of the game in page.boot.image."
      )
    );
  });

  // Bug: a negative or NaN fade lands in the style as a broken transition and the timer fires at once.
  it("refuses a page.boot.fadeMs that is not a finite number of 0 or more", () => {
    for (const fadeMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resolveConfig({ page: { title: "T", boot: { image: "assets/boot.png", fadeMs } } })
      ).toThrow(
        new Error(
          `[game] config.page.boot.fadeMs is ${String(fadeMs)}.\n  Use a number of milliseconds, 0 or more.`
        )
      );
    }
  });

  // Bug: the type takes a boot with nothing to show, or makes every game write a boot.
  it("the type refuses a boot without an image and takes a page without a boot", () => {
    expectTypeOf<{ page: { title: string } }>().toExtend<GameConfig>();
    expectTypeOf<{ page: { title: string; boot: { image: string } } }>().toExtend<GameConfig>();
    expectTypeOf<{ page: { title: string; boot: { width: string } } }>().not.toExtend<GameConfig>();
  });
});
