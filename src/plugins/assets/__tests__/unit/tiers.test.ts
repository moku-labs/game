import { afterEach, describe, expect, it, vi } from "vitest";
import { bootTiers, isPermanent, loadBundle } from "../../tiers";
import type { AssetsCtx, Manifest } from "../../types";
import {
  createMockAssets,
  leaving,
  type MockAssets,
  manifestOf,
  packedManifest
} from "./mock-assets";

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

/** A bundle of four sounds: an `.mp3` and an `.m4a` of a dev build, two hashed ones of a pack. */
const soundsManifest: Manifest = {
  version: 2,
  bundles: {
    ui: {
      feature: "ui",
      tier: "scene",
      mb: 0.04,
      files: [
        {
          key: "ui.click",
          path: "features/ui/assets/click.mp3",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.01
        },
        {
          key: "ui.horn",
          path: "features/ui/assets/HORN.M4A",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.01
        },
        {
          key: "ui.pop",
          path: "ui/ui.pop-5e0a71bd42.mp3",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.01
        },
        {
          key: "ui.theme",
          path: "ui/ui.theme-9c4e2b7a10.m4a",
          kind: "audio",
          width: 0,
          height: 0,
          mb: 0.01
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

describe("loadBundle in the performance log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the load in an agent build, and nowhere without the flag", async () => {
    const plain = createMockAssets({ manifest: boardManifest });

    await plain.start();
    await loadBundle(plain.assetsCtx, "board", undefined, "request");

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const agent = createMockAssets({ manifest: boardManifest });

    await agent.start();
    await loadBundle(agent.assetsCtx, "board", undefined, "request");

    expect(plain.renderer.api.monitor.event).not.toHaveBeenCalled();
    expect(agent.renderer.api.monitor.event).toHaveBeenCalledWith("bundle", {
      bundle: "board",
      action: "load",
      tier: "scene",
      mb: 0.126,
      reason: "request"
    });
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

describe("loadBundle of sounds", () => {
  it("keeps each sound as its fetched bytes and the MIME type of its container", async () => {
    const mock = createMockAssets({ manifest: soundsManifest });

    mock.io.bodies.set("/features/ui/assets/click.mp3", new Uint8Array([1, 2, 3]).buffer);
    await mock.start();
    await loadBundle(mock.assetsCtx, "ui", undefined, "request");

    const audio = mock.ctx.state.records.get("ui")?.audio;
    const click = audio?.get("ui.click");

    expect(click).toEqual({ bytes: expect.any(ArrayBuffer), mime: "audio/mpeg" });
    expect([...new Uint8Array(click?.bytes ?? new ArrayBuffer(0))]).toEqual([1, 2, 3]);
    // An upper-case extension is the same container.
    expect(audio?.get("ui.horn")?.mime).toBe("audio/mp4");
    // A hashed name of the packer keeps the extension, so it keeps the type.
    expect(audio?.get("ui.pop")?.mime).toBe("audio/mpeg");
    expect(audio?.get("ui.theme")?.mime).toBe("audio/mp4");
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

/**
 * Builds a manifest whose bundle `board` holds one texture at the given path.
 *
 * @param path - Path of the one file.
 * @returns A v1 manifest.
 */
function oneFileManifest(path: string): Manifest {
  return {
    version: 1,
    bundles: {
      board: {
        feature: "board",
        tier: "scene",
        mb: 0.063,
        files: [{ key: "board.cell", path, width: 128, height: 128, mb: 0.063 }]
      }
    }
  };
}

describe("a file the protocol answers with index.html", () => {
  it("fails a 200 text/html file like a 404, naming the status and the type", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.contentTypes.set("/features/board/assets/item.png", "text/html");

    await expect(loadBundle(mock.assetsCtx, "board", undefined, "enter")).rejects.toThrow(
      '[game] assets: bundle "board" failed at "features/board/assets/item.png" (200, text/html).'
    );

    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");
    expect(mock.io.destroyed).toHaveLength(mock.io.created.length);
    expect(mock.log.error).toHaveBeenCalledWith("assets: bundle failed", {
      bundle: "board",
      file: "features/board/assets/item.png",
      status: 200,
      contentType: "text/html"
    });
  });

  it("keeps the content type of a 404 in the log entry", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    await mock.start();
    mock.io.status.set("/features/board/assets/item.png", 404);
    mock.io.contentTypes.set("/features/board/assets/item.png", "text/html; charset=utf-8");

    await expect(loadBundle(mock.assetsCtx, "board", undefined, "enter")).rejects.toThrow(
      "(404, text/html; charset=utf-8)."
    );
    expect(mock.log.error).toHaveBeenCalledWith(
      "assets: bundle failed",
      expect.objectContaining({ status: 404, contentType: "text/html; charset=utf-8" })
    );
  });

  it("loads a .ktx2 served as application/octet-stream", async () => {
    const mock = createMockAssets({
      manifest: oneFileManifest("features/board/assets/cell.ktx2")
    });

    await mock.start();
    mock.io.contentTypes.set("/features/board/assets/cell.ktx2", "application/octet-stream");

    await loadBundle(mock.assetsCtx, "board", undefined, "enter");

    expect(mock.ctx.state.records.get("board")?.status).toBe("loaded");
    expect(mock.io.created.map(texture => texture.from)).toEqual([
      "/features/board/assets/cell.ktx2"
    ]);
    expect(mock.log.error).not.toHaveBeenCalled();
  });

  it("loads an .html file served as text/html", async () => {
    const mock = createMockAssets({
      manifest: oneFileManifest("features/board/assets/help.html")
    });

    await mock.start();
    mock.io.contentTypes.set("/features/board/assets/help.html", "text/html");

    await loadBundle(mock.assetsCtx, "board", undefined, "enter");

    expect(mock.ctx.state.records.get("board")?.status).toBe("loaded");
  });

  it("fails a manifest served as 200 text/html with the could-not-be-read error", async () => {
    const mock = createMockAssets({ manifest: "/assets/manifest.json" }, boardManifest);

    mock.io.contentTypes.set("/assets/manifest.json", "text/html");

    await expect(mock.start()).rejects.toThrow(
      '[game] assets: the manifest at "/assets/manifest.json" could not be read (200, text/html).'
    );
  });

  it("fails a 404 manifest with the bare status", async () => {
    const mock = createMockAssets({ manifest: "/assets/manifest.json" }, boardManifest);

    mock.io.status.set("/assets/manifest.json", 404);

    await expect(mock.start()).rejects.toThrow("could not be read (404).");
  });

  it("reads a manifest served as application/json", async () => {
    const mock = createMockAssets({ manifest: "/assets/manifest.json" }, boardManifest);

    mock.io.contentTypes.set("/assets/manifest.json", "application/json");
    await mock.start();

    expect(Object.keys(mock.ctx.state.manifest.bundles)).toEqual(["board"]);
  });
});

/** A companion whose `load` waits until the test lets it go. */
type HeldCompanion = {
  load: ReturnType<typeof vi.fn<(bundle: string) => Promise<void>>>;
  unload: ReturnType<typeof vi.fn<(bundle: string) => void>>;
  resolve(): void;
  reject(error: unknown): void;
};

/**
 * Creates a companion whose every `load` waits for `resolve` or `reject`.
 *
 * @returns The companion and the two switches.
 */
function heldCompanion(): HeldCompanion {
  const waiting: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  return {
    load: vi.fn(
      (_bundle: string) =>
        new Promise<void>((resolve, reject) => {
          waiting.push({ resolve, reject });
        })
    ),
    unload: vi.fn(),
    resolve: () => {
      for (const entry of waiting.splice(0)) entry.resolve();
    },
    reject: (error: unknown) => {
      for (const entry of waiting.splice(0)) entry.reject(error);
    }
  };
}

/**
 * The names of the events a mock recorded.
 *
 * @param mock - The mock plugin.
 * @returns Their names, in order.
 */
function eventsOf(mock: MockAssets): string[] {
  return mock.emitted.map(entry => entry.name);
}

describe("loadBundle with companions", () => {
  it("calls a companion's load once with the bundle, and publishes the bundle only after it resolved", async () => {
    const mock = createMockAssets({ manifest: boardManifest });
    const companion = heldCompanion();

    await mock.start();
    mock.api.companions.add(companion);

    const first = loadBundle(mock.assetsCtx, "board", undefined, "enter");
    const second = loadBundle(mock.assetsCtx, "board", undefined, "request");
    let settled = false;
    const watched = first.then(() => {
      settled = true;
    });

    await tick();

    // Every file arrived; the strings of the bundle did not.
    expect(mock.io.created).toHaveLength(2);
    expect(mock.ctx.state.records.get("board")?.status).toBe("loading");
    expect(eventsOf(mock)).not.toContain("assets:bundle-loaded");
    expect(settled).toBe(false);

    companion.resolve();
    await Promise.all([watched, second]);

    expect(companion.load.mock.calls).toEqual([["board"]]);
    expect(eventsOf(mock)).toContain("assets:bundle-loaded");
    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("calls no load for a bundle that is already loaded, and none headless", async () => {
    const mock = createMockAssets({ manifest: boardManifest });
    const headless = createMockAssets({ manifest: boardManifest, io: undefined });
    const companion = { load: vi.fn(async () => undefined), unload: vi.fn() };

    await mock.start();
    await headless.start();
    await mock.api.load("board");
    mock.api.companions.add(companion);
    headless.api.companions.add(companion);
    await mock.api.load("board");
    await headless.api.load("board");

    expect(companion.load).not.toHaveBeenCalled();
  });

  it.each([
    ["rejects", (companion: HeldCompanion) => companion.reject(new Error("no strings"))],
    [
      "throws",
      (companion: HeldCompanion) => {
        companion.load.mockImplementation(() => {
          throw new Error("no strings");
        });
      }
    ]
  ])("fails the bundle when a companion's load %s: files freed, every unload called, every waiter rejected", async (how, breakIt) => {
    const mock = createMockAssets({ manifest: boardManifest });
    const broken = heldCompanion();
    const fine = { load: vi.fn(async () => undefined), unload: vi.fn() };

    await mock.start();
    mock.api.companions.add(broken);
    mock.api.companions.add(fine);

    if (how === "throws") breakIt(broken);

    const first = loadBundle(mock.assetsCtx, "board", undefined, "enter");
    const second = loadBundle(mock.assetsCtx, "board", undefined, "request");
    // Both waiters are watched at once: a companion that throws fails the load within the tick.
    const settled = Promise.allSettled([first, second]);

    await tick();
    if (how === "rejects") breakIt(broken);

    const results = await settled;

    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
    await expect(first).rejects.toThrow("no strings");
    await expect(second).rejects.toThrow("no strings");
    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");
    expect(mock.io.destroyed).toHaveLength(2);
    expect(broken.unload.mock.calls).toEqual([["board"]]);
    expect(fine.unload.mock.calls).toEqual([["board"]]);
    expect(mock.log.error).toHaveBeenCalledWith("assets: bundle failed", {
      bundle: "board",
      error: "Error: no strings"
    });
    expect(eventsOf(mock)).not.toContain("assets:bundle-loaded");
  });

  it("calls the companion's unload after an aborted load", async () => {
    const mock = createMockAssets({ manifest: boardManifest });
    const companion = { load: vi.fn(async () => undefined), unload: vi.fn() };

    await mock.start();
    mock.api.companions.add(companion);
    mock.io.control.gated = true;

    const controller = new AbortController();
    const only = loadBundle(mock.assetsCtx, "board", controller.signal, "preload");

    await tick();
    controller.abort();
    await expect(only).rejects.toMatchObject({ name: "AbortError" });
    await tick();

    expect(companion.unload.mock.calls).toEqual([["board"]]);
    expect(mock.log.error).not.toHaveBeenCalled();
  });
});

describe("loadBundle of a mipmapped file", () => {
  it("uploads it with its mip chain and keeps the borders of a nine-slice", async () => {
    const mipmapped: Manifest = {
      version: 1,
      bundles: {
        ep01: {
          feature: "ep01",
          tier: "lazy",
          mb: 0.659,
          files: [
            {
              key: "ep01.cup",
              path: "features/ep01/assets/cup.png",
              width: 336,
              height: 288,
              mb: 0.492,
              mips: true
            },
            {
              key: "ep01.frame",
              path: "features/ep01/assets/frame{nine=8}.png",
              width: 256,
              height: 128,
              mb: 0.167,
              mips: true,
              nine: { left: 8, top: 8, right: 8, bottom: 8 }
            }
          ]
        }
      }
    };
    const mock = createMockAssets({ manifest: mipmapped });

    await mock.start();
    await mock.api.load("ep01");

    expect(mock.io.created.map(texture => [texture.from, texture.mips, texture.nine])).toEqual([
      ["/features/ep01/assets/cup.png", true, undefined],
      ["/features/ep01/assets/frame{nine=8}.png", true, [8, 8, 8, 8]]
    ]);
  });
});

describe("the declared release", () => {
  it("warns once when the declared release disagrees with the manifest", async () => {
    const mock = createMockAssets({ manifest: boardManifest });

    mock.flow.features.push({
      name: "board",
      description: {
        assets: { kind: "bundles", map: { board: { tier: "scene", release: "leave" } } }
      }
    });
    await mock.start();

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith(
      "assets: bundle release disagrees with the manifest",
      { feature: "board", bundle: "board", declared: "leave", manifest: "budget" }
    );
  });

  it("says nothing when both sides leave", async () => {
    const mock = createMockAssets({ manifest: leaving(boardManifest, "board") });

    mock.flow.features.push({
      name: "board",
      description: {
        assets: { kind: "bundles", map: { board: { tier: "scene", release: "leave" } } }
      }
    });
    await mock.start();

    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});

describe("the dev check of sub-feature bundles", () => {
  /** A manifest with the bundle of the sub-feature ep01 and the flat board. */
  const nested: Manifest = {
    version: 1,
    bundles: {
      ...boardManifest.bundles,
      ep01: {
        feature: "ep01",
        parent: "episodes",
        dir: "features/episodes/ep01",
        tier: "lazy",
        mb: 0,
        files: []
      }
    }
  };

  it("warns once for a bundle with a parent whose feature nobody registered, never for a flat one", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = createMockAssets({ manifest: nested });

    mock.flow.features.push({ name: "episodes", description: {} });
    await mock.start();

    expect(mock.log.warn).toHaveBeenCalledExactlyOnceWith(
      "assets: the manifest has a bundle of a feature nobody registered",
      {
        bundle: "ep01",
        feature: "ep01",
        parent: "episodes",
        fix: 'List it in features: [...] of "episodes".'
      }
    );

    vi.unstubAllGlobals();
  });

  it("says nothing once the sub-feature is registered, and nothing outside dev", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const registered = createMockAssets({ manifest: nested });

    registered.flow.features.push({ name: "ep01", description: {} });
    await registered.start();
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const built = createMockAssets({ manifest: nested });

    await built.start();

    expect(registered.log.warn).not.toHaveBeenCalled();
    expect(built.log.warn).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
