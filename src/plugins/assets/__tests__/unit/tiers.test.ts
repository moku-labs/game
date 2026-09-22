import { describe, expect, it, vi } from "vitest";
import { bootTiers, isPermanent, loadBundle } from "../../tiers";
import type { AssetsCtx } from "../../types";
import { createMockAssets, manifestOf } from "./mock-assets";

const boardManifest = manifestOf({
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] }
});

const bootManifest = manifestOf({
  boot: { feature: "ui", tier: "boot", keys: ["ui.logo"] },
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] }
});

/**
 * Lets the microtask queue run, so a started-but-not-awaited load reaches its first fetch.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
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

  it("refuses a file that is packed in an atlas", async () => {
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
      "is packed in an atlas"
    );
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
