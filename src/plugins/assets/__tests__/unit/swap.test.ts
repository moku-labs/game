import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { loadBundle } from "../../tiers";
import type { AssetStamps, HotSwap, Manifest } from "../../types";
import { createMockAssets, type FakeTexture, type MockAssets, packedManifest } from "./mock-assets";

// ---------------------------------------------------------------------------
// Unit test: the dev hot swap of asset files, through the `ui:hot-swap` hook
// over the fake io. `moku-game dev` stamps every asset file; here a test hands
// the hook the stamp the page would get, and a spy stands in for the reload.
// ---------------------------------------------------------------------------

/** The path the hot footer reports for the stamp module. */
const STAMP = "/game/.moku/assets-stamp.ts";

const CELL = "features/board/assets/cell.png";
const FNT = "features/ui/assets/body.fnt";
const PAGE_0 = "features/ui/assets/body_0.png";
const PAGE_1 = "features/ui/assets/body_1.png";
const CLICK = "features/ui/assets/click.mp3";
const ICON = "features/ui/assets/icon.png";
const PANEL = "features/ui/assets/panel{nine=48}.png";

/** Every asset path of the manifest below: what the keys watch stamps for this game. */
const PATHS = [CELL, FNT, PAGE_0, PAGE_1, CLICK, ICON, PANEL];

/** The `.fnt` file the fake io serves at boot. */
const FNT_TEXT =
  'info face="body" size=32\npage id=0 file="body_0.png"\npage id=1 file="body_1.png"\n';

/**
 * Two bundles: `board` with one texture; `ui` with a font of two pages, a sound, a plain texture
 * and a nine-slice.
 */
const manifest: Manifest = {
  version: 1,
  bundles: {
    board: {
      feature: "board",
      tier: "scene",
      mb: 0.063,
      files: [{ key: "board.cell", path: CELL, width: 128, height: 128, mb: 0.063 }]
    },
    ui: {
      feature: "ui",
      tier: "scene",
      mb: 0.459,
      files: [
        {
          key: "ui.body",
          path: FNT,
          kind: "font",
          width: 0,
          height: 0,
          mb: 0.25,
          pages: [
            { path: PAGE_0, width: 256, height: 128, mb: 0.125 },
            { path: PAGE_1, width: 256, height: 128, mb: 0.125 }
          ]
        },
        { key: "ui.click", path: CLICK, kind: "audio", width: 0, height: 0, mb: 0.021 },
        { key: "ui.icon", path: ICON, width: 128, height: 128, mb: 0.063 },
        {
          key: "ui.panel",
          path: PANEL,
          width: 256,
          height: 128,
          mb: 0.125,
          nine: { left: 48, top: 48, right: 48, bottom: 48 }
        }
      ]
    }
  }
};

/** One file the io was asked for, and the events that had gone out by then. */
type Ask = { url: string; emitted: string[] };

/** A started dev page: the mock, the reload spy and the two ways to send a stamp. */
type DevPage = {
  mock: MockAssets;
  reload: Mock<() => void>;
  /** Sends one `ui:hot-swap` and returns at once, as the event bus does. */
  hook: (payload: HotSwap) => void;
  /** Sends the stamp module and waits for the swap it queued. */
  swap: (stamps: AssetStamps) => Promise<void>;
  /** Every file the io was asked for since the page started, in order. */
  asks: Ask[];
  /** Resolves once the io was asked for that many files: a load or a swap reached its fetch. */
  asked: (count: number) => Promise<void>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The URL the fake io sees for a manifest path: an inline manifest is served from the site root.
 *
 * @param path - A path of the manifest.
 * @returns The URL of the file.
 */
function url(path: string): string {
  return `/${path}`;
}

/**
 * Builds the `files` map of a stamp: every path of the game at its first stamp, then the patch.
 *
 * @param patch - The paths whose stamp differs, and paths the manifest does not know.
 * @returns Path to its `size:mtimeMs`.
 */
function filesOf(patch: Record<string, string> = {}): Record<string, string> {
  return { ...Object.fromEntries(PATHS.map(path => [path, "100:1"])), ...patch };
}

/**
 * Takes one path out of a `files` map, as the keys watch does for a file that left the game.
 *
 * @param files - Path to its stamp.
 * @param gone - The path that left.
 * @returns The map without it.
 */
function without(files: Record<string, string>, gone: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== gone));
}

/**
 * Builds the stamp after a save of the given files: their stamps moved, and `changed` names them.
 *
 * @param changed - The saved paths.
 * @returns The default export of the stamp module.
 */
function saved(...changed: string[]): AssetStamps {
  return { files: filesOf(Object.fromEntries(changed.map(path => [path, "200:2"]))), changed };
}

/**
 * Empties the recordings of a mock, so a test reads only what its swap did.
 *
 * @param mock - The mock plugin.
 */
function forget(mock: MockAssets): void {
  mock.io.fetched.length = 0;
  mock.io.created.length = 0;
  mock.io.destroyed.length = 0;
  mock.renderer.invalidated.length = 0;
  mock.emitted.length = 0;
  mock.time.wake.mockClear();
}

/**
 * Starts the plugin as a dev page over the fake io, loads the bundles and forgets what the boot
 * recorded.
 *
 * @param bundles - The bundles that are loaded when the stamp arrives.
 * @param source - The manifest the page booted with.
 * @returns The page.
 */
async function startDev(
  bundles: readonly string[] = ["board", "ui"],
  source: Manifest = manifest
): Promise<DevPage> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const mock = createMockAssets({ manifest: source });
  const reload: Mock<() => void> = vi.fn();

  mock.io.texts.set(url(FNT), FNT_TEXT);
  mock.io.sizes.set(url(PAGE_0), { width: 256, height: 128 });
  mock.io.sizes.set(url(PAGE_1), { width: 256, height: 128 });
  mock.io.sizes.set(url(PANEL), { width: 256, height: 128 });

  await mock.start();

  for (const bundle of bundles) await mock.api.load(bundle);

  forget(mock);

  const hook = createHandlers(mock.ctx, reload)["ui:hot-swap"];
  const asks: Ask[] = [];
  const waiting: Array<{ count: number; resolve: () => void }> = [];
  const fetch = mock.io.fetch;

  // Every fetch is noted with the events that went out before it: a test waits for the fetch
  // itself, never for time to pass, and pins what came first.
  mock.io.fetch = (file, init) => {
    asks.push({ url: file, emitted: mock.emitted.map(entry => entry.name) });

    for (const waiter of waiting.splice(0)) {
      if (asks.length >= waiter.count) waiter.resolve();
      else waiting.push(waiter);
    }

    return fetch(file, init);
  };

  return {
    mock,
    reload,
    hook,
    swap: async (stamps: AssetStamps): Promise<void> => {
      hook({ file: STAMP, module: { default: stamps } });

      await mock.ctx.state.swapping;
    },
    asks,
    asked: (count: number): Promise<void> =>
      asks.length >= count
        ? Promise.resolve()
        : new Promise(resolve => {
            waiting.push({ count, resolve });
          })
  };
}

/**
 * Reads the `assets:replaced` events a mock recorded.
 *
 * @param mock - The mock plugin.
 * @returns Their payloads, in order.
 */
function replaced(mock: MockAssets): unknown[] {
  return mock.emitted.filter(entry => entry.name === "assets:replaced").map(entry => entry.payload);
}

describe("the dev hot swap: a texture", () => {
  it("replaces a changed texture of a loaded bundle with a new one", async () => {
    const { mock, reload, swap } = await startDev(["board"]);
    const old = mock.api.texture("board.cell");
    const decode = vi.spyOn(mock.io, "decode");
    const store = vi.spyOn(mock.ctx.state.records.get("board")?.textures ?? new Map(), "set");
    const destroy = vi.spyOn(mock.io, "destroyTexture");

    await swap(saved(CELL));

    const fresh = mock.api.texture("board.cell");

    // Fetched and decoded once, and the key answers the new texture.
    expect(mock.io.fetched).toEqual([url(CELL)]);
    expect(decode).toHaveBeenCalledOnce();
    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.created[0]).toBe(fresh);
    expect(fresh).not.toBe(old);
    // The old texture goes only after the new one is stored.
    expect(store).toHaveBeenCalledExactlyOnceWith("board.cell", fresh);
    expect(destroy).toHaveBeenCalledExactlyOnceWith(old);
    expect(store.mock.invocationCallOrder[0]).toBeLessThan(
      destroy.mock.invocationCallOrder[0] ?? 0
    );
    // The views of the key are written again, the frame loop wakes and the event goes out once.
    expect(mock.renderer.invalidated).toEqual([["board.cell"]]);
    expect(mock.time.wake).toHaveBeenCalledOnce();
    expect(mock.emitted).toEqual([
      { name: "assets:replaced", payload: { bundle: "board", keys: ["board.cell"] } }
    ]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the borders of a nine-slice file", async () => {
    const { mock, swap } = await startDev(["ui"]);

    await swap(saved(PANEL));

    const fresh = mock.api.texture("ui.panel") as unknown as FakeTexture;

    expect(mock.io.created[0]).toBe(fresh);
    expect(fresh.nine).toEqual([48, 48, 48, 48]);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.panel"] }]);
  });

  it("leaves the manifest as it is when the size did not change", async () => {
    const { mock, swap } = await startDev(["ui"]);
    const before = structuredClone(mock.ctx.state.manifest);

    await swap(saved(ICON, PANEL, PAGE_0, CLICK));

    expect(mock.ctx.state.manifest).toEqual(before);
    expect(mock.api.usage().textureMb).toBe(0.459);
  });

  it("writes a new size into the file record, the bundle and the usage", async () => {
    const { mock, swap } = await startDev(["ui"]);

    mock.io.sizes.set(url(ICON), { width: 256, height: 256 });
    await swap(saved(ICON));

    const bundle = mock.ctx.state.manifest.bundles.ui;

    expect(bundle?.files.find(file => file.key === "ui.icon")).toEqual({
      key: "ui.icon",
      path: ICON,
      width: 256,
      height: 256,
      mb: 0.25
    });
    // 0.25 font + 0.021 sound + 0.25 icon + 0.125 panel.
    expect(bundle?.mb).toBe(0.646);
    expect(mock.api.usage().textureMb).toBe(0.646);
    expect(mock.api.usage().bundles).toEqual([
      { name: "ui", tier: "scene", mb: 0.646, lastUsed: expect.any(Number) }
    ]);
  });

  it("enforces the budget with the new size", async () => {
    const { mock, swap } = await startDev(["board", "ui"]);

    // 0.522 MB are loaded; the bigger icon makes it 0.709.
    mock.config.textureBudgetMb = 0.7;
    mock.io.sizes.set(url(ICON), { width: 256, height: 256 });
    await swap(saved(ICON));

    // `board` was used longest ago, so it leaves; the swapped bundle stays and reports.
    expect(mock.api.isLoaded("board")).toBe(false);
    expect(mock.api.isLoaded("ui")).toBe(true);
    expect(mock.emitted.map(entry => entry.name)).toEqual([
      "assets:bundle-unloaded",
      "assets:replaced"
    ]);
  });

  it("says nothing about a bundle the budget took with its new size", async () => {
    const { mock, swap } = await startDev(["ui", "board"]);

    mock.config.textureBudgetMb = 0.7;
    mock.io.sizes.set(url(ICON), { width: 256, height: 256 });
    await swap(saved(ICON));

    // `ui` is the older one here: the budget unloads it, the new icon included.
    expect(mock.api.isLoaded("ui")).toBe(false);
    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.destroyed).toContain(mock.io.created[0]);
    expect(mock.emitted.map(entry => entry.name)).toEqual(["assets:bundle-unloaded"]);
  });
});

describe("the dev hot swap: a font", () => {
  it("reads the whole font again when one page changed, and keeps the numbers true", async () => {
    const { mock, swap } = await startDev(["ui"]);
    const old = mock.ctx.state.records.get("ui")?.fonts.get("ui.body");

    mock.io.sizes.set(url(PAGE_1), { width: 512, height: 128 });
    await swap(saved(PAGE_1));

    const fresh = mock.ctx.state.records.get("ui")?.fonts.get("ui.body");
    const bundle = mock.ctx.state.manifest.bundles.ui;
    const font = bundle?.files.find(file => file.key === "ui.body");

    // The `.fnt` and both pages once: a font is one asset.
    expect(mock.io.fetched.toSorted()).toEqual([url(FNT), url(PAGE_0), url(PAGE_1)]);
    expect(fresh).not.toBe(old);
    expect(fresh?.pages).toEqual(mock.io.created);
    expect(fresh?.texture).toBe(mock.io.created[0]);
    expect(fresh?.fnt).toBe(FNT_TEXT);
    expect(mock.api.font("ui.body")?.texture).toBe(fresh?.texture);
    // The old pages go, both of them, and none of the new ones.
    expect(old?.pages).toHaveLength(2);
    expect(mock.io.destroyed).toEqual(old?.pages);
    // The page, the font and the bundle carry the new megabytes.
    expect(font?.pages).toEqual([
      { path: PAGE_0, width: 256, height: 128, mb: 0.125 },
      { path: PAGE_1, width: 512, height: 128, mb: 0.25 }
    ]);
    expect(font?.mb).toBe(0.375);
    // 0.375 font + 0.021 sound + 0.063 icon + 0.125 panel.
    expect(bundle?.mb).toBe(0.584);
    expect(mock.renderer.invalidated).toEqual([["ui.body"]]);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.body"] }]);
  });

  it("replaces the font once when its .fnt changed", async () => {
    const { mock, swap } = await startDev(["ui"]);
    const text = 'info face="body" size=40\npage id=0 file="body_0.png"\n';

    mock.io.texts.set(url(FNT), text);
    await swap(saved(FNT));

    expect(mock.api.font("ui.body")?.fnt).toBe(text);
    expect(mock.io.fetched.filter(fetched => fetched === url(FNT))).toHaveLength(1);
    expect(mock.io.created).toHaveLength(2);
    expect(mock.io.destroyed).toHaveLength(2);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.body"] }]);
  });

  it("replaces the font once when its .fnt and its pages changed in one save", async () => {
    const { mock, swap } = await startDev(["ui"]);

    await swap(saved(FNT, PAGE_0, PAGE_1));

    expect(mock.io.fetched.toSorted()).toEqual([url(FNT), url(PAGE_0), url(PAGE_1)]);
    expect(mock.io.created).toHaveLength(2);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.body"] }]);
  });
});

describe("the dev hot swap: a sound", () => {
  it("replaces the bytes of a changed sound", async () => {
    const { mock, swap } = await startDev(["ui"]);
    const bytes = new Uint8Array([9, 8, 7]).buffer;

    mock.io.bodies.set(url(CLICK), bytes);
    await swap(saved(CLICK));

    expect(mock.api.audio("ui.click")?.bytes).toBe(bytes);
    expect(mock.api.audio("ui.click")?.mime).toBe("audio/mpeg");
    expect(mock.io.fetched).toEqual([url(CLICK)]);
    // A sound is no texture: nothing is made and nothing is destroyed.
    expect(mock.io.created).toEqual([]);
    expect(mock.io.destroyed).toEqual([]);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.click"] }]);
  });
});

describe("the dev hot swap: which bundles", () => {
  it("does nothing for a file of a bundle that is not loaded", async () => {
    const { mock, reload, swap } = await startDev(["board"]);

    await swap(saved(ICON));

    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect(mock.renderer.invalidated).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("sends one event per bundle when a save touched two of them", async () => {
    const { mock, swap } = await startDev();

    await swap(saved(CELL, ICON, PANEL));

    expect(replaced(mock)).toEqual([
      { bundle: "board", keys: ["board.cell"] },
      { bundle: "ui", keys: ["ui.icon", "ui.panel"] }
    ]);
    expect(mock.renderer.invalidated).toEqual([["board.cell"], ["ui.icon", "ui.panel"]]);
  });

  it("swaps a bundle that is loading only after its load settled", async () => {
    const { mock, hook, asks, asked } = await startDev([]);

    mock.io.control.gated = true;

    const loading = mock.api.load("board");

    // The running load holds its fetch when the stamp arrives.
    await asked(1);
    hook({ file: STAMP, module: { default: saved(CELL) } });
    mock.io.control.gated = false;
    mock.io.releaseAll();
    await loading;
    await mock.ctx.state.swapping;

    // The swap asked for the file only after the load had landed.
    expect(asks).toEqual([
      { url: url(CELL), emitted: [] },
      { url: url(CELL), emitted: ["assets:bundle-progress", "assets:bundle-loaded"] }
    ]);
    expect(mock.io.fetched).toEqual([url(CELL), url(CELL)]);
    expect(mock.io.created).toHaveLength(2);
    expect(mock.api.texture("board.cell")).toBe(mock.io.created[1]);
    expect(mock.io.destroyed).toEqual([mock.io.created[0]]);
    expect(mock.emitted.map(entry => entry.name)).toEqual([
      "assets:bundle-progress",
      "assets:bundle-loaded",
      "assets:replaced"
    ]);
  });

  it("skips a bundle whose running load was given up", async () => {
    const { mock, hook, asked } = await startDev([]);
    const caller = new AbortController();

    mock.io.control.gated = true;

    const loading = loadBundle(mock.assetsCtx, "board", caller.signal, "request").catch(
      () => undefined
    );

    // The load holds its fetch when the stamp arrives; then its only waiter leaves.
    await asked(1);
    hook({ file: STAMP, module: { default: saved(CELL) } });
    caller.abort();
    await loading;
    await mock.ctx.state.swapping;

    // The last waiter left, so the bundle is idle again: its next load reads the new bytes.
    expect(mock.api.isLoaded("board")).toBe(false);
    expect(mock.io.fetched).toEqual([url(CELL)]);
    expect(mock.emitted).toEqual([]);
  });

  it("destroys the new texture and says nothing when the bundle was unloaded on the way", async () => {
    const { mock, reload, hook, asked } = await startDev(["board"]);

    mock.io.control.gated = true;
    hook({ file: STAMP, module: { default: saved(CELL) } });
    // The swap holds its fetch when the bundle leaves.
    await asked(1);

    expect(mock.io.fetched).toEqual([url(CELL)]);

    // The game, or the budget at a rest node, lets the bundle go while the new file is on the way.
    mock.api.unload("board");
    forget(mock);
    mock.io.control.gated = false;
    mock.io.releaseAll();
    await mock.ctx.state.swapping;

    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.destroyed).toEqual(mock.io.created);
    expect(mock.ctx.state.records.get("board")?.textures.size).toBe(0);
    expect(mock.emitted).toEqual([]);
    expect(mock.renderer.invalidated).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the dev hot swap: which paths", () => {
  it("takes the changed list of the first stamp, and nothing else", async () => {
    const { mock, swap } = await startDev();
    const files = filesOf({ [CELL]: "200:2", [ICON]: "200:2" });

    // The first update after boot has no map to compare with: only `changed` counts.
    await swap({ files, changed: [CELL] });

    expect(mock.io.fetched).toEqual([url(CELL)]);
    expect(mock.ctx.state.stamps).toBe(files);
  });

  it("does nothing for a first stamp that names no file, and keeps its map", async () => {
    const { mock, reload, swap } = await startDev();
    const files = filesOf();

    await swap({ files, changed: [] });

    expect(mock.io.fetched).toEqual([]);
    expect(mock.ctx.state.stamps).toBe(files);
    expect(mock.ctx.state.swapping).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("compares a later stamp with the map it applied, also when changed is empty", async () => {
    const { mock, swap } = await startDev();

    await swap(saved(CELL));
    forget(mock);

    // Two updates reached the page as one: the list is empty, the map still tells.
    await swap({ files: filesOf({ [CELL]: "200:2", [ICON]: "300:3" }), changed: [] });

    expect(mock.io.fetched).toEqual([url(ICON)]);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.icon"] }]);
  });

  it("goes by the map of a later stamp, not by its changed list", async () => {
    const { mock, swap } = await startDev();

    await swap(saved(CELL));
    forget(mock);
    await swap({ files: filesOf({ [CELL]: "200:2" }), changed: [ICON] });

    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });

  it("ignores a changed image outside every bundle folder", async () => {
    const { mock, reload, swap } = await startDev();
    const outside = { "web/favicon.png": "200:2", "features/ui/thumb.png": "200:2" };

    await swap({ files: filesOf(outside), changed: Object.keys(outside) });

    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores a file the manifest does not know while it did not change", async () => {
    const { mock, reload, swap } = await startDev();

    await swap({ files: filesOf({ "features/ui/assets/draft.png": "100:1" }), changed: [CELL] });

    expect(mock.io.fetched).toEqual([url(CELL)]);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the dev hot swap: a file that fails keeps the old asset", () => {
  it("logs a failed fetch, does not reload and still answers the old texture", async () => {
    const { mock, reload, swap } = await startDev(["board"]);
    const old = mock.api.texture("board.cell");
    const stamps = saved(CELL);

    mock.io.status.set(url(CELL), 404);
    await swap(stamps);

    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("assets:replace-failed", {
      path: CELL,
      reason: `[game] assets: bundle "board" failed at "${CELL}" (404).`
    });
    expect(reload).not.toHaveBeenCalled();
    // The old texture is alive and it is still what the key answers.
    expect(mock.api.texture("board.cell")).toBe(old);
    expect(mock.io.destroyed).toEqual([]);
    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.emitted).toEqual([]);
    expect(mock.renderer.invalidated).toEqual([]);
    // The new stamp is kept, so the broken file is not read again until it is saved again.
    expect(mock.ctx.state.stamps).toBe(stamps.files);
  });

  it("logs a failed decode, does not reload and still answers the old texture", async () => {
    const { mock, reload, swap } = await startDev(["board"]);
    const old = mock.api.texture("board.cell");

    vi.spyOn(mock.io, "decode").mockRejectedValueOnce("the image could not be decoded");
    await swap(saved(CELL));

    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("assets:replace-failed", {
      path: CELL,
      reason: "the image could not be decoded"
    });
    expect(reload).not.toHaveBeenCalled();
    expect(mock.api.texture("board.cell")).toBe(old);
    expect(mock.io.destroyed).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });

  it("keeps the old font and its pages when one page fails", async () => {
    const { mock, reload, swap } = await startDev(["ui"]);
    const old = mock.ctx.state.records.get("ui")?.fonts.get("ui.body");

    mock.io.status.set(url(PAGE_1), 404);
    await swap(saved(PAGE_1));

    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("assets:replace-failed", {
      path: FNT,
      reason: `[game] assets: bundle "ui" failed at "${PAGE_1}" (404).`
    });
    expect(reload).not.toHaveBeenCalled();
    expect(mock.ctx.state.records.get("ui")?.fonts.get("ui.body")).toBe(old);
    expect(mock.api.font("ui.body")?.texture).toBe(old?.texture);
    // The first page arrived before the second failed: it is given back, the old ones stay.
    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.destroyed).toEqual(mock.io.created);
    expect(mock.emitted).toEqual([]);
  });

  it("keeps the old bytes of a sound that fails", async () => {
    const { mock, reload, swap } = await startDev(["ui"]);
    const old = mock.api.audio("ui.click");

    mock.io.status.set(url(CLICK), 404);
    await swap(saved(CLICK));

    expect(mock.log.error).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    expect(mock.api.audio("ui.click")).toBe(old);
    expect(mock.emitted).toEqual([]);
  });

  it("frees what the bundle already made and stores none of it, the good files too", async () => {
    const { mock, reload, swap } = await startDev(["ui"]);
    const before = structuredClone(mock.ctx.state.manifest);
    const icon = mock.api.texture("ui.icon");

    mock.io.status.set(url(PANEL), 404);
    mock.io.sizes.set(url(ICON), { width: 256, height: 256 });
    await swap(saved(ICON, PANEL));

    // The icon was fetched and uploaded although the panel failed: it is given back.
    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.destroyed).toEqual(mock.io.created);
    expect(mock.api.texture("ui.icon")).toBe(icon);
    expect(mock.ctx.state.manifest).toEqual(before);
    expect(mock.api.usage().textureMb).toBe(0.459);
    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("assets:replace-failed", {
      path: PANEL,
      reason: `[game] assets: bundle "ui" failed at "${PANEL}" (404).`
    });
    expect(reload).not.toHaveBeenCalled();
    expect(mock.emitted).toEqual([]);
    expect(mock.renderer.invalidated).toEqual([]);
  });

  it("replaces the other bundle of the same swap", async () => {
    const { mock, reload, swap } = await startDev();
    const cell = mock.api.texture("board.cell");
    const icon = mock.api.texture("ui.icon");

    mock.io.status.set(url(CELL), 404);
    await swap(saved(CELL, ICON));

    expect(mock.io.fetched).toEqual([url(CELL), url(ICON)]);
    expect(mock.api.texture("board.cell")).toBe(cell);
    expect(mock.api.texture("ui.icon")).not.toBe(icon);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.icon"] }]);
    expect(mock.log.error).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not read the broken file again until it is saved again", async () => {
    const { mock, reload, swap } = await startDev();

    mock.io.status.set(url(CELL), 404);
    await swap(saved(CELL));
    mock.io.status.delete(url(CELL));
    forget(mock);

    // Another file is saved: the stamp of the broken one did not move, so it is left alone.
    await swap({ files: filesOf({ [CELL]: "200:2", [ICON]: "300:3" }), changed: [ICON] });

    expect(mock.io.fetched).toEqual([url(ICON)]);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.icon"] }]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("swaps the file on its next good save", async () => {
    const { mock, reload, swap } = await startDev(["board"]);
    const old = mock.api.texture("board.cell");

    mock.io.status.set(url(CELL), 404);
    await swap(saved(CELL));
    mock.io.status.delete(url(CELL));
    await swap({ files: filesOf({ [CELL]: "300:3" }), changed: [CELL] });

    const fresh = mock.api.texture("board.cell");

    expect(fresh).not.toBe(old);
    expect(mock.io.created).toHaveLength(1);
    expect(mock.io.created[0]).toBe(fresh);
    expect(mock.io.destroyed).toEqual([old]);
    expect(replaced(mock)).toEqual([{ bundle: "board", keys: ["board.cell"] }]);
    expect(mock.log.error).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the dev hot swap: what reloads the page instead", () => {
  it("refuses when a file of the manifest left the game", async () => {
    const { mock, reload, swap } = await startDev();
    await swap({ files: without(filesOf({ [CELL]: "200:2" }), ICON), changed: [CELL] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${ICON}" left the game`
    });
    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect(mock.ctx.state.swapping).toBeUndefined();
  });

  it("refuses when a font page of the manifest left the game", async () => {
    const { mock, reload, swap } = await startDev();
    await swap({ files: without(filesOf(), PAGE_1), changed: [] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${PAGE_1}" left the game`
    });
  });

  it.each([
    ["next to the files of a bundle", "features/ui/assets/badge.png"],
    ["in a new folder of a bundle", "features/ui/assets/fx/leaf.webp"]
  ])("refuses a new file %s", async (_where, path) => {
    const { mock, reload, swap } = await startDev();

    await swap({ files: filesOf({ [path]: "200:2", [CELL]: "200:2" }), changed: [CELL, path] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${path}" is not in the manifest`
    });
    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });

  it("refuses a renamed nine-slice tag: one path left and one is new", async () => {
    const { reload, swap } = await startDev();
    const renamed = "features/ui/assets/panel{nine=32}.png";
    await swap({ files: without(filesOf({ [renamed]: "200:2" }), PANEL), changed: [renamed] });

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when a replace breaks after its files arrived, and names every file of the bundle", async () => {
    const { mock, reload, swap } = await startDev(["ui"]);

    vi.spyOn(mock.io, "destroyTexture").mockImplementation(() => {
      throw new Error("the device is lost");
    });
    await swap(saved(ICON, PANEL));

    expect(mock.log.error).toHaveBeenCalledTimes(2);
    expect(mock.log.error).toHaveBeenCalledWith("assets:replace-failed", {
      path: ICON,
      reason: "the device is lost"
    });
    expect(mock.log.error).toHaveBeenCalledWith("assets:replace-failed", {
      path: PANEL,
      reason: "the device is lost"
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(mock.emitted).toEqual([]);
  });

  it("stops at the bundle whose replace broke: the page reloads anyway", async () => {
    const { mock, reload, swap } = await startDev();

    vi.spyOn(mock.io, "destroyTexture").mockImplementation(() => {
      throw new Error("the device is lost");
    });
    await swap(saved(CELL, ICON));

    expect(mock.io.fetched).toEqual([url(CELL)]);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads the page through location.reload when no seam was passed", async () => {
    const reload = vi.fn();

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    vi.stubGlobal("location", { reload });

    const mock = createMockAssets({ manifest });

    await mock.start();
    createHandlers(mock.ctx)["ui:hot-swap"]({
      file: STAMP,
      module: { default: { files: {}, changed: [] } }
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it("refuses without a throw where there is no page to reload", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = createMockAssets({ manifest });

    await mock.start();

    expect(() =>
      createHandlers(mock.ctx)["ui:hot-swap"]({
        file: STAMP,
        module: { default: { files: {}, changed: [] } }
      })
    ).not.toThrow();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${CELL}" left the game`
    });
  });
});

describe("the dev hot swap: the folders the scanner read", () => {
  const COIN = "features/shop/assets/icons/coin.png";
  const LOGO = "art/logo.png";
  const ROOT = "splash.png";

  /** A feature whose files all lie in a subfolder, a hand-written path and a file at the root. */
  const source: Manifest = {
    version: 1,
    bundles: {
      shop: {
        feature: "shop",
        tier: "scene",
        mb: 0.189,
        files: [
          { key: "shop.icons.coin", path: COIN, width: 128, height: 128, mb: 0.063 },
          { key: "shop.logo", path: LOGO, width: 128, height: 128, mb: 0.063 },
          { key: "shop.splash", path: ROOT, width: 128, height: 128, mb: 0.063 }
        ]
      }
    }
  };

  const known = { [COIN]: "100:1", [LOGO]: "100:1", [ROOT]: "100:1" };

  it.each([
    ["in assets/ of a feature whose files lie deeper", "features/shop/assets/banner.png"],
    ["next to a file whose path has no assets folder", "art/draft.png"]
  ])("refuses a new file %s", async (_where, path) => {
    const { mock, reload, swap } = await startDev(["shop"], source);

    await swap({ files: { ...known, [path]: "200:2" }, changed: [path] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${path}" is not in the manifest`
    });
  });

  it("ignores a new image at the root, where a manifest file without a folder lies", async () => {
    const { mock, reload, swap } = await startDev(["shop"], source);
    const outside = { "favicon.png": "200:2", "features/shop/thumb.png": "200:2" };

    await swap({ files: { ...known, ...outside }, changed: Object.keys(outside) });

    expect(reload).not.toHaveBeenCalled();
    expect(mock.io.fetched).toEqual([]);
  });

  it("swaps the file at the root and the one under the hand-written folder", async () => {
    const { mock, swap } = await startDev(["shop"], source);

    await swap({ files: { ...known, [LOGO]: "200:2", [ROOT]: "200:2" }, changed: [LOGO, ROOT] });

    expect(replaced(mock)).toEqual([{ bundle: "shop", keys: ["shop.logo", "shop.splash"] }]);
  });
});

describe("the dev hot swap: a new file where the manifest names no folder yet", () => {
  // The scanner reads `<features>/<feature>/assets/` and `<layer>/assets/`. The page knows neither
  // the layers nor the features folder, so the shape of the path decides.
  it.each([
    ["the first file of a feature that had no assets", "features/shop/assets/coin.png"],
    ["the first file of a new feature, in a subfolder", "features/shop/assets/icons/coin.png"],
    ["the first file of a layer that had no assets", "shared/assets/button/primary.png"],
    ["a file of a features folder with another name", "game/shop/assets/coin.png"]
  ])("refuses %s and reloads", async (_what, path) => {
    const { mock, reload, swap } = await startDev();

    await swap({ files: filesOf({ [path]: "200:2" }), changed: [path] });

    expect(reload).toHaveBeenCalledOnce();
    expect(mock.log.info).toHaveBeenCalledExactlyOnceWith("assets:swap-refused", {
      reason: `"${path}" is not in the manifest`
    });
    expect(mock.io.fetched).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });

  it.each([
    ["a favicon at the root", "favicon.webp"],
    ["an image of a feature outside its assets folder", "features/home/outside.webp"],
    ["an assets folder at the root, which is no layer", "assets/logo.png"],
    ["an assets folder deeper than the scanner looks", "tools/art/src/assets/draft.png"],
    ["a file that only has the name of the folder", "features/home/assets.webp"],
    ["a file named assets where the folder would be", "shared/assets"]
  ])("ignores %s", async (_what, path) => {
    const { mock, reload, swap } = await startDev();

    await swap({ files: filesOf({ [path]: "200:2" }), changed: [path] });

    expect(reload).not.toHaveBeenCalled();
    expect(mock.log.info).not.toHaveBeenCalled();
    expect(mock.io.fetched).toEqual([]);
  });

  it("still swaps a known file saved together with an ignored one", async () => {
    const { mock, reload, swap } = await startDev();

    await swap({
      files: filesOf({ "favicon.webp": "200:2", [CELL]: "200:2" }),
      changed: [CELL, "favicon.webp"]
    });

    expect(reload).not.toHaveBeenCalled();
    expect(replaced(mock)).toEqual([{ bundle: "board", keys: ["board.cell"] }]);
  });
});

describe("the dev hot swap: a bundle with atlas pages", () => {
  it("keeps the pages in the megabytes of the bundle", async () => {
    const BG = "ui/ui.bg-5e0a71bd42.webp";
    const { mock, swap } = await startDev(["ui"], packedManifest());

    mock.io.sizes.set(url(BG), { width: 512, height: 512 });
    await swap({ files: { [BG]: "200:2" }, changed: [BG] });

    const bundle = mock.ctx.state.manifest.bundles.ui;

    expect(bundle?.files.find(file => file.key === "ui.bg")?.mb).toBe(1);
    // The loose background is 1 MB now, and the page the other three files are cut from is 1 MB.
    expect(bundle?.mb).toBe(2);
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.bg"] }]);
  });
});

describe("the dev hot swap: one at a time", () => {
  it("starts the second swap only after the first one settled", async () => {
    const { mock, hook, asks, asked } = await startDev();

    mock.io.control.gated = true;
    hook({ file: STAMP, module: { default: saved(CELL) } });
    // The first swap holds its fetch when the second stamp arrives.
    await asked(1);
    hook({
      file: STAMP,
      module: { default: { files: filesOf({ [CELL]: "200:2", [ICON]: "300:3" }), changed: [ICON] } }
    });
    mock.io.control.gated = false;
    mock.io.releaseAll();
    await mock.ctx.state.swapping;

    // The second swap asked for its file only after the first one had told its bundle.
    expect(asks).toEqual([
      { url: url(CELL), emitted: [] },
      { url: url(ICON), emitted: ["assets:replaced"] }
    ]);
    expect(replaced(mock)).toEqual([
      { bundle: "board", keys: ["board.cell"] },
      { bundle: "ui", keys: ["ui.icon"] }
    ]);
  });

  it("keeps the chain of swaps alive after a replace that broke", async () => {
    const { mock, reload, swap } = await startDev();

    vi.spyOn(mock.io, "destroyTexture").mockImplementationOnce(() => {
      throw new Error("the device is lost");
    });
    await swap(saved(CELL));
    await swap({ files: filesOf({ [CELL]: "300:3" }), changed: [CELL] });

    expect(reload).toHaveBeenCalledOnce();
    expect(replaced(mock)).toEqual([{ bundle: "board", keys: ["board.cell"] }]);
  });

  it("keeps the chain of swaps alive after a file that failed", async () => {
    const { mock, reload, swap } = await startDev();

    mock.io.status.set(url(CELL), 404);
    await swap(saved(CELL));
    await swap({ files: filesOf({ [CELL]: "200:2", [ICON]: "300:3" }), changed: [ICON] });

    expect(reload).not.toHaveBeenCalled();
    expect(replaced(mock)).toEqual([{ bundle: "ui", keys: ["ui.icon"] }]);
  });
});

describe("the dev hot swap: when it does not run", () => {
  it("does nothing without the dev flag", async () => {
    const { mock, reload, swap } = await startDev();

    vi.unstubAllGlobals();
    await swap(saved(CELL));

    expect(mock.io.fetched).toEqual([]);
    expect(mock.ctx.state.stamps).toBeUndefined();
    expect(mock.ctx.state.swapping).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing when the dev flag is false, as in a built game", async () => {
    const { mock, swap } = await startDev();

    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    await swap(saved(CELL));

    expect(mock.io.fetched).toEqual([]);
    expect(mock.ctx.state.stamps).toBeUndefined();
  });

  it("does nothing while headless", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = createMockAssets({ manifest, io: undefined });
    const reload = vi.fn();

    await mock.start();
    // A headless page has no file: even a stamp that would be refused does nothing.
    createHandlers(mock.ctx, reload)["ui:hot-swap"]({
      file: STAMP,
      module: { default: { files: {}, changed: [] } }
    });

    expect(mock.ctx.state.stamps).toBeUndefined();
    expect(mock.ctx.state.swapping).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
    expect(mock.log.info).not.toHaveBeenCalled();
  });

  it("does nothing for the hot swap of another file", async () => {
    const { mock, reload, hook } = await startDev();

    hook({ file: "/game/features/hud/view.tsx", module: { default: saved(CELL) } });
    hook({ file: "/game/generated/assets-stamp.ts", module: { default: saved(CELL) } });

    expect(mock.io.fetched).toEqual([]);
    expect(mock.ctx.state.stamps).toBeUndefined();
    expect(mock.ctx.state.swapping).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing for a stamp module that carries no stamp", async () => {
    const { mock, reload, hook } = await startDev();

    hook({ file: STAMP, module: { default: "3f2a9c" } });
    hook({ file: STAMP, module: {} });

    expect(mock.ctx.state.stamps).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("takes the stamp file by a Windows path too", async () => {
    const { mock, hook } = await startDev();

    hook({ file: String.raw`C:\game\.moku\assets-stamp.ts`, module: { default: saved(CELL) } });
    await mock.ctx.state.swapping;

    expect(mock.io.fetched).toEqual([url(CELL)]);
  });
});
