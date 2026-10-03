import { describe, expect, it, vi } from "vitest";
import { bootTiers, isPermanent, loadBundle } from "../../tiers";
import type { AssetsCtx, Manifest } from "../../types";
import { createMockAssets, type MockAssets, manifestOf, packedManifest } from "./mock-assets";

const boardManifest = manifestOf({
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] }
});

const bootManifest = manifestOf({
  boot: { feature: "ui", tier: "boot", keys: ["ui.logo"] },
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] }
});

/** A bundle with a font of two pages, a sound and a texture: three files, five fetches. */
const mixedManifest: Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "scene",
      mb: 0.334,
      files: [
        {
          key: "ui.body",
          path: "features/ui/assets/body.fnt",
          kind: "font",
          width: 0,
          height: 0,
          mb: 0.25,
          pages: [
            { path: "features/ui/assets/body_0.png", width: 256, height: 128, mb: 0.125 },
            { path: "features/ui/assets/body_1.png", width: 256, height: 128, mb: 0.125 }
          ]
        },
        {
          key: "ui.click",
          path: "features/ui/assets/click.mp3",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.021
        },
        {
          key: "ui.panel",
          path: "features/ui/assets/panel.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    }
  }
};

/**
 * Lets the microtask queue run, so a started-but-not-awaited load reaches its first fetch.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Reads the progress events a mock recorded, in the order they went out.
 *
 * @param mock - The mock plugin.
 * @returns The payloads of every `assets:bundle-progress`.
 */
function progressOf(mock: MockAssets): unknown[] {
  return mock.emitted
    .filter(entry => entry.name === "assets:bundle-progress")
    .map(entry => entry.payload);
}

describe("isPermanent", () => {
  it("is true for boot and core only", () => {
    expect(isPermanent("boot")).toBe(true);
    expect(isPermanent("core")).toBe(true);
    expect(isPermanent("scene")).toBe(false);
    expect(isPermanent("feature")).toBe(false);
    expect(isPermanent("lazy")).toBe(false);
  });
});

describe("loadBundle", () => {
  it("loads every file, invalidates the keys and emits the event", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(mock.io.created).toHaveLength(2);
    expect(mock.renderer.invalidated.at(-1)).toEqual(["board.cell", "board.item"]);
    expect(mock.emitted.at(-1)).toEqual({
      name: "assets:bundle-loaded",
      payload: { bundle: "board", tier: "scene", mb: 0.126, reason: "request" }
    });
  });

  it("rejects an unknown bundle and names the fix", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();

    await expect(loadBundle(mock.assetsCtx, "bord", undefined, "request")).rejects.toThrow(
      '[game] assets: no bundle "bord" in the manifest.\n  Run "bun run assets:keys".'
    );
  });

  it("resolves at once for a loaded bundle and touches the use counter", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    const fetches = mock.io.fetched.length;

    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(mock.io.fetched).toHaveLength(fetches);
    expect(mock.ctx.state.records.get("board")?.lastUsed).toBe(mock.ctx.state.useCounter);
  });

  it("resolves at once and touches nothing while headless", async () => {
    const mock = createMockAssets({ manifest: boardManifest, io: undefined });

    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(mock.io.fetched).toEqual([]);
    expect(mock.ctx.state.records.size).toBe(0);
    expect(mock.emitted).toEqual([]);
  });

  it("joins a running load instead of fetching twice", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.control.gated = true;

    const first = loadBundle(mock.assetsCtx, "board", undefined, "enter");
    const second = loadBundle(mock.assetsCtx, "board", undefined, "request");

    await tick();
    expect(mock.io.fetched).toHaveLength(2);

    mock.io.releaseAll();
    await Promise.all([first, second]);

    expect(mock.io.created).toHaveLength(2);
    expect(mock.emitted.filter(entry => entry.name === "assets:bundle-loaded")).toHaveLength(1);
  });

  it("keeps the reason of the caller that started the load", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.control.gated = true;

    const first = loadBundle(mock.assetsCtx, "board", undefined, "preload");
    const second = loadBundle(mock.assetsCtx, "board", undefined, "request");

    await tick();
    mock.io.releaseAll();
    await Promise.all([first, second]);

    expect(mock.emitted.at(-1)).toMatchObject({ payload: { reason: "preload" } });
  });

  it("rejects only the caller whose signal aborted", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.control.gated = true;

    const controller = new AbortController();
    const aborted = loadBundle(mock.assetsCtx, "board", controller.signal, "preload");
    const joined = loadBundle(mock.assetsCtx, "board", undefined, "request");

    await tick();
    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    mock.io.releaseAll();
    await joined;

    expect(mock.ctx.state.records.get("board")?.status).toBe("loaded");
  });

  it("aborts the fetches when the last waiter leaves", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.control.gated = true;

    const controller = new AbortController();
    const only = loadBundle(mock.assetsCtx, "board", controller.signal, "preload");

    await tick();
    controller.abort();

    await expect(only).rejects.toMatchObject({ name: "AbortError" });
    await tick();

    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");
    expect(mock.io.created).toEqual([]);
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("fails the bundle with the file and the status, and destroys what it had", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.status.set("/features/board/assets/item.png", 404);

    await expect(loadBundle(mock.assetsCtx, "board", undefined, "enter")).rejects.toThrow(
      '[game] assets: bundle "board" failed at "features/board/assets/item.png" (404).'
    );

    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");
    expect(mock.io.destroyed).toHaveLength(mock.io.created.length);
    expect(mock.log.error).toHaveBeenCalledWith("assets: bundle failed", {
      bundle: "board",
      file: "features/board/assets/item.png",
      status: 404
    });
  });

  it("slices a v1 file that carries an atlas, and fails it when its page is not listed", async () => {
    const withAtlas = {
      version: 1,
      bundles: {
        ui: {
          feature: "ui",
          tier: "core",
          mb: 0,
          files: [
            {
              key: "ui.panel",
              path: "features/ui/assets/panel.png",
              width: 1,
              height: 1,
              mb: 0,
              atlas: { page: "ui-0.png", x: 0, y: 0, width: 1, height: 1 }
            }
          ]
        }
      }
    };
    const mock = createMockAssets({ manifest: withAtlas as never });

    await mock.start();

    await expect(loadBundle(mock.assetsCtx, "ui", undefined, "request")).rejects.toThrow(
      '[game] assets: file "ui.panel" of bundle "ui" names page "ui-0.png", which the bundle does not list.\n  Run "bun run assets:pack".'
    );
    expect(mock.io.fetched).not.toContain("/features/ui/assets/panel.png");
  });

  it("fails a file that has neither a path nor an atlas frame, and names its key", async () => {
    const pathless = {
      version: 2,
      bundles: {
        ui: {
          feature: "ui",
          tier: "core",
          mb: 0,
          files: [{ key: "ui.panel", width: 1, height: 1, mb: 0 }]
        }
      }
    };
    const mock = createMockAssets({ manifest: pathless as never });

    await mock.start();

    await expect(loadBundle(mock.assetsCtx, "ui", undefined, "request")).rejects.toThrow(
      '[game] assets: file "ui.panel" of bundle "ui" has neither a path nor an atlas frame.\n  Run "bun run assets:pack".'
    );
  });
});

describe("loadBundle of a packed bundle", () => {
  it("fetches the page once and cuts every packed file out of it, frame and nine", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    await loadBundle(mock.assetsCtx, "ui", undefined, "request");

    expect(mock.io.fetched.filter(url => url.includes("main-0"))).toEqual([
      "/ui/main-0-3b1d55a0c9.webp"
    ]);

    const page = mock.io.created.find(texture => texture.from.includes("main-0"));

    expect(page?.nine).toBeUndefined();
    expect(mock.io.sliced).toEqual([
      {
        id: "s1",
        page: page?.id,
        frame: { page: "ui/main-0", x: 2, y: 2, width: 64, height: 64 },
        nine: undefined
      },
      {
        id: "s2",
        page: page?.id,
        frame: { page: "ui/main-0", x: 68, y: 2, width: 64, height: 64 },
        nine: undefined
      },
      {
        id: "s3",
        page: page?.id,
        frame: { page: "ui/main-0", x: 2, y: 68, width: 256, height: 128 },
        nine: [48, 48, 48, 48]
      }
    ]);
  });

  it("loads a loose file next to the packed ones as before", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    await loadBundle(mock.assetsCtx, "ui", undefined, "request");

    const record = mock.ctx.state.records.get("ui");

    expect(mock.io.fetched).toContain("/ui/ui.bg-5e0a71bd42.webp");
    expect(record?.textures.get("ui.bg")).toMatchObject({ from: "/ui/ui.bg-5e0a71bd42.webp" });
    expect(record?.textures.get("ui.panel")).toMatchObject({ id: "s3" });
    expect([...(record?.pages.keys() ?? [])]).toEqual(["ui/main-0"]);
    expect(mock.renderer.invalidated.at(-1)).toEqual([
      "ui.bg",
      "ui.icon-coin",
      "ui.icon-gear",
      "ui.panel"
    ]);
  });

  it("counts files, not pages, and settles the files of a page together after it landed", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    mock.io.control.gated = true;

    const loading = loadBundle(mock.assetsCtx, "ui", undefined, "request");

    await tick();
    mock.io.release(url => url.includes("ui.bg"));
    await tick();
    expect(progressOf(mock)).toEqual([{ bundle: "ui", loaded: 1, total: 4 }]);

    mock.io.releaseAll();
    await loading;

    expect(progressOf(mock)).toEqual([
      { bundle: "ui", loaded: 1, total: 4 },
      { bundle: "ui", loaded: 2, total: 4 },
      { bundle: "ui", loaded: 3, total: 4 },
      { bundle: "ui", loaded: 4, total: 4 }
    ]);
  });

  it("fails every file of a page that does not arrive, naming the page and the status", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    mock.io.status.set("/ui/main-0-3b1d55a0c9.webp", 404);

    await expect(loadBundle(mock.assetsCtx, "ui", undefined, "request")).rejects.toThrow(
      '[game] assets: bundle "ui" failed at "ui/main-0-3b1d55a0c9.webp" (404).'
    );

    expect(mock.io.sliced).toEqual([]);
    expect(mock.ctx.state.records.get("ui")?.status).toBe("idle");
    expect(mock.log.error).toHaveBeenCalledWith("assets: bundle failed", {
      bundle: "ui",
      file: "ui/main-0-3b1d55a0c9.webp",
      status: 404
    });
  });

  it("destroys the slices before their page when the load fails", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    mock.io.status.set("/ui/ui.bg-5e0a71bd42.webp", 404);

    await expect(loadBundle(mock.assetsCtx, "ui", undefined, "request")).rejects.toThrow("(404)");

    expect(mock.io.destroyed.map(texture => texture.id)).toEqual(["s1", "s2", "s3", "t1"]);
  });

  it("names an unknown page id and the command that fixes it", async () => {
    const manifest = packedManifest();
    const ui = manifest.bundles.ui;

    if (ui === undefined) throw new Error("the packed manifest lost its bundle");

    const broken = {
      ...manifest,
      bundles: {
        ui: {
          ...ui,
          files: ui.files.map(file =>
            file.key === "ui.icon-coin" && file.atlas !== undefined
              ? { ...file, atlas: { ...file.atlas, page: "ui/main-9" } }
              : file
          )
        }
      }
    };
    const mock = createMockAssets({ manifest: broken });

    await mock.start();

    await expect(loadBundle(mock.assetsCtx, "ui", undefined, "request")).rejects.toThrow(
      '[game] assets: file "ui.icon-coin" of bundle "ui" names page "ui/main-9", which the bundle does not list.\n  Run "bun run assets:pack".'
    );
    expect(mock.io.destroyed).toHaveLength(mock.io.created.length + mock.io.sliced.length);
  });

  it("aborts the page fetch with the last waiter and makes no slice", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    mock.io.control.gated = true;

    const controller = new AbortController();
    const only = loadBundle(mock.assetsCtx, "ui", controller.signal, "preload");

    await tick();
    controller.abort();

    await expect(only).rejects.toMatchObject({ name: "AbortError" });
    await tick();

    expect(mock.io.sliced).toEqual([]);
    expect(mock.ctx.state.records.get("ui")?.status).toBe("idle");
    expect(mock.log.error).not.toHaveBeenCalled();
  });
});

describe("loadBundle progress", () => {
  it("counts every settled file once, a font with its pages, and ends at the total", async () => {
    const mock = createMockAssets({ manifest: mixedManifest });

    await mock.start();
    mock.io.control.gated = true;

    const loading = loadBundle(mock.assetsCtx, "ui", undefined, "request");

    // The texture settles first, then the sound: settle order, not manifest order.
    await tick();
    mock.io.release(url => url.endsWith("panel.png"));
    await tick();
    expect(progressOf(mock)).toEqual([{ bundle: "ui", loaded: 1, total: 3 }]);

    mock.io.release(url => url.endsWith("click.mp3"));
    await tick();
    expect(progressOf(mock)).toHaveLength(2);

    // The .fnt file alone is not the font: its two pages are still on the way.
    mock.io.release(url => url.endsWith("body.fnt"));
    await tick();
    expect(mock.io.held.map(entry => entry.url)).toEqual([
      "/features/ui/assets/body_0.png",
      "/features/ui/assets/body_1.png"
    ]);
    expect(progressOf(mock)).toHaveLength(2);

    mock.io.releaseAll();
    await loading;

    expect(progressOf(mock)).toEqual([
      { bundle: "ui", loaded: 1, total: 3 },
      { bundle: "ui", loaded: 2, total: 3 },
      { bundle: "ui", loaded: 3, total: 3 }
    ]);
  });

  it("sends the last progress before assets:bundle-loaded", async () => {
    const mock = createMockAssets({ manifest: mixedManifest });

    await mock.start();
    await loadBundle(mock.assetsCtx, "ui", undefined, "request");

    expect(mock.emitted.map(entry => entry.name)).toEqual([
      "assets:bundle-progress",
      "assets:bundle-progress",
      "assets:bundle-progress",
      "assets:bundle-loaded"
    ]);
    expect(mock.emitted.at(-2)?.payload).toEqual({ bundle: "ui", loaded: 3, total: 3 });
  });

  it("counts a file that failed, and sends no bundle-loaded after it", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.status.set("/features/board/assets/item.png", 404);

    await expect(loadBundle(mock.assetsCtx, "board", undefined, "enter")).rejects.toThrow("(404)");

    expect(progressOf(mock)).toEqual([
      { bundle: "board", loaded: 1, total: 2 },
      { bundle: "board", loaded: 2, total: 2 }
    ]);
    expect(mock.emitted.map(entry => entry.name)).not.toContain("assets:bundle-loaded");
  });

  it("sends nothing for the files of an aborted load", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.control.gated = true;

    const controller = new AbortController();
    const only = loadBundle(mock.assetsCtx, "board", controller.signal, "preload");

    await tick();
    controller.abort();

    await expect(only).rejects.toMatchObject({ name: "AbortError" });
    await tick();

    expect(progressOf(mock)).toEqual([]);
  });

  it("sends nothing for a bundle that is already loaded", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    const sent = mock.emitted.length;

    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(mock.emitted).toHaveLength(sent);
  });
});

describe("bootTiers", () => {
  it("awaits the boot tier and leaves the core tier loading", async () => {
    const mock = createMockAssets({ manifest: bootManifest });

    mock.ctx.state.io = mock.io;
    mock.io.control.gated = true;

    const booting = bootTiers(mock.assetsCtx as AssetsCtx);

    await tick();
    mock.io.release(url => url.includes("logo"));
    await booting;

    expect(mock.ctx.state.records.get("boot")?.status).toBe("loaded");
    expect(mock.ctx.state.records.get("ui")?.status).toBe("loading");

    mock.io.releaseAll();
    await tick();
  });

  it("warns about a declared bundle the manifest does not carry", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    mock.flow.features.push({
      name: "board",
      description: { assets: { kind: "bundles", map: { "board.chains": { tier: "lazy" } } } }
    });

    await mock.start();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: bundle is not in the manifest",
      expect.objectContaining({ bundle: "board.chains" })
    );
  });

  it("warns about a declared bundle whose tier disagrees with the manifest", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    mock.flow.features.push({
      name: "board",
      description: { assets: { kind: "bundles", map: { board: { tier: "lazy" } } } }
    });

    await mock.start();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: bundle tier disagrees with the manifest",
      expect.objectContaining({ bundle: "board", declared: "lazy", manifest: "scene" })
    );
  });

  it("fetches the manifest from its URL", async () => {
    const mock = createMockAssets({ manifest: "/assets/manifest.json" }, boardManifest);

    await mock.start();

    expect(mock.io.fetched[0]).toBe("/assets/manifest.json");
    expect(Object.keys(mock.ctx.state.manifest.bundles)).toEqual(["board"]);
  });

  it("warns and stays empty when the manifest cannot be read while headless", async () => {
    const mock = createMockAssets({ manifest: "/assets/manifest.json", io: undefined });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });

    vi.stubGlobal("fetch", failing);
    await mock.start();
    vi.unstubAllGlobals();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: the manifest could not be read",
      expect.anything()
    );
    expect(mock.ctx.state.manifest.bundles).toEqual({});
  });
});
