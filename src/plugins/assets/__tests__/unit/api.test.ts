import { describe, expect, it, vi } from "vitest";
import { lookupTexture } from "../../api";
import { releaseLeftBundles } from "../../budget";
import { loadBundle } from "../../tiers";
import type { Manifest } from "../../types";
import { createMockAssets, leaving, manifestOf, packedManifest } from "./mock-assets";

const manifest = manifestOf({
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] },
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] },
  "board.chains": { feature: "board", tier: "lazy", keys: ["board.chain"] }
});

/** One bundle of two sounds: an `.mp3` and an `.m4a`. */
const soundManifest: Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "scene",
      mb: 0.02,
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
          key: "ui.theme",
          path: "features/ui/assets/theme.m4a",
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
 * Lets the microtask queue run.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("load", () => {
  it("loads the bundle through the API", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await mock.api.load("board");

    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("rejects an unknown bundle", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();

    await expect(mock.api.load("bord")).rejects.toThrow('no bundle "bord" in the manifest');
  });
});

describe("unload", () => {
  it("frees a loaded scene bundle", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await mock.api.load("board");
    mock.api.unload("board");

    expect(mock.api.isLoaded("board")).toBe(false);
    expect(mock.io.destroyed).toHaveLength(2);
  });

  it("refuses a permanent tier with a warning", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await mock.api.load("ui");
    mock.api.unload("ui");

    expect(mock.api.isLoaded("ui")).toBe(true);
    expect(mock.log.warn).toHaveBeenCalledWith("assets: this bundle cannot be unloaded", {
      bundle: "ui",
      reason: "tier"
    });
  });

  it("refuses a pinned bundle with a warning", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await mock.api.load("board");
    mock.ctx.state.pinned = new Set(["board"]);
    mock.api.unload("board");

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.log.warn).toHaveBeenCalledWith("assets: this bundle cannot be unloaded", {
      bundle: "board",
      reason: "pinned"
    });
  });

  it("aborts a running load", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.io.control.gated = true;

    const running = mock.api.load("board");
    const failed = running.catch((error: unknown) => (error as Error).name);

    await tick();
    mock.api.unload("board");

    expect(await failed).toBe("AbortError");
    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");
  });

  it("does nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();
    mock.api.unload("board");

    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});

describe("isLoaded", () => {
  it("is false before the load and true after it", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();

    expect(mock.api.isLoaded("board")).toBe(false);

    await mock.api.load("board");

    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("is true for every bundle of the manifest while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.api.isLoaded("bord")).toBe(false);
  });
});

describe("texture", () => {
  it("answers a loaded key and touches the use counter of its bundle", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await mock.api.load("board");

    const before = mock.ctx.state.useCounter;
    const texture = mock.api.texture("board.cell");

    expect(texture).toBeDefined();
    expect(mock.ctx.state.useCounter).toBe(before + 1);
    expect(mock.ctx.state.records.get("board")?.lastUsed).toBe(before + 1);
  });

  it("warns once and loads the bundle in the background on a miss", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();

    expect(mock.api.texture("board.cell")).toBeUndefined();
    expect(mock.api.texture("board.cell")).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("assets: texture is not loaded yet", {
      key: "board.cell",
      bundle: "board"
    });

    await tick();

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.renderer.invalidated.at(-1)).toEqual(["board.cell", "board.item"]);
  });

  it("asks again after a failed background load, and still warns only once", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.io.status.set("/features/board/assets/cell.png", 503);

    expect(mock.api.texture("board.cell")).toBeUndefined();
    await tick();

    expect(mock.ctx.state.records.get("board")?.status).toBe("idle");

    const attempts = mock.io.fetched.filter(url => url.endsWith("cell.png")).length;

    mock.io.status.delete("/features/board/assets/cell.png");

    expect(mock.api.texture("board.cell")).toBeUndefined();
    await tick();

    expect(mock.io.fetched.filter(url => url.endsWith("cell.png"))).toHaveLength(attempts + 1);
    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.api.texture("board.cell")).toBeDefined();
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
  });

  it("joins the running load instead of starting a second one", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.io.control.gated = true;

    expect(mock.api.texture("board.cell")).toBeUndefined();
    await tick();

    const started = mock.io.fetched.length;

    expect(mock.api.texture("board.cell")).toBeUndefined();
    expect(mock.api.texture("board.item")).toBeUndefined();
    await tick();

    expect(mock.io.fetched).toHaveLength(started);

    mock.io.releaseAll();
    await tick();

    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("answers undefined for a key of no bundle", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();

    expect(mock.api.texture("nowhere.key")).toBeUndefined();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("answers undefined while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();

    expect(mock.api.texture("board.cell")).toBeUndefined();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("is the same function the texture provider uses", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(lookupTexture(mock.assetsCtx, "board.cell")).toBe(mock.api.texture("board.cell"));
  });
});

describe("usage", () => {
  it("reports the loaded bundles sorted by name", async () => {
    const mock = createMockAssets({ manifest, textureBudgetMb: 64 });

    await mock.start();
    await mock.api.load("board");
    await mock.api.load("ui");

    const usage = mock.api.usage();

    expect(usage.budgetMb).toBe(64);
    expect(usage.textureMb).toBeCloseTo(0.189, 3);
    expect(usage.bundles.map(entry => entry.name)).toEqual(["board", "ui"]);
    expect(usage.bundles[0]).toEqual({
      name: "board",
      tier: "scene",
      mb: 0.126,
      lastUsed: expect.any(Number)
    });
  });

  it("reports nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();

    expect(mock.api.usage()).toEqual({ textureMb: 0, budgetMb: 192, bundles: [] });
  });
});

describe("texture of a packed key", () => {
  it("answers the slice cut out of the page", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    await mock.start();
    await mock.api.load("ui");

    expect(mock.api.texture("ui.panel")).toMatchObject({
      id: "s3",
      frame: { x: 2, y: 68, width: 256, height: 128 },
      nine: [48, 48, 48, 48]
    });
    expect(mock.api.texture("ui.bg")).toMatchObject({ from: "/ui/ui.bg-5e0a71bd42.webp" });
  });

  it("answers undefined while headless and fetches nothing", async () => {
    const mock = createMockAssets({ manifest: packedManifest(), io: undefined });

    await mock.start();
    await mock.api.load("ui");

    expect(mock.api.isLoaded("ui")).toBe(true);
    expect(mock.api.texture("ui.panel")).toBeUndefined();
    expect(mock.io.fetched).toEqual([]);
  });
});

describe("audio", () => {
  it("answers the bytes and the MIME type of a loaded sound and touches the use counter", async () => {
    const mock = createMockAssets({ manifest: soundManifest });

    await mock.start();
    await mock.api.load("ui");

    const before = mock.ctx.state.useCounter;

    expect(mock.api.audio("ui.theme")).toEqual({
      bytes: expect.any(ArrayBuffer),
      mime: "audio/mp4"
    });
    expect(mock.api.audio("ui.click")?.mime).toBe("audio/mpeg");
    expect(mock.ctx.state.useCounter).toBe(before + 2);
    expect(mock.ctx.state.records.get("ui")?.lastUsed).toBe(before + 2);
  });

  it("answers undefined while headless and fetches nothing", async () => {
    const mock = createMockAssets({ manifest: soundManifest, io: undefined });

    await mock.start();
    await mock.api.load("ui");

    expect(mock.api.audio("ui.click")).toBeUndefined();
    expect(mock.io.fetched).toEqual([]);
  });
});

describe("sceneBundles", () => {
  it("replaces the list of the mounted scene with a copy: only what the last call named is held", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "board", "board.chains") });

    await mock.start();
    await mock.api.load("board");
    await mock.api.load("board.chains");

    const named = ["board", "board.chains"];

    mock.api.sceneBundles(named);
    mock.api.sceneBundles(["board"]);
    named.length = 0;
    releaseLeftBundles(mock.assetsCtx);

    expect(mock.ctx.state.sceneNamed).toEqual(["board"]);
    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.api.isLoaded("board.chains")).toBe(false);
  });
});

describe("the bundles of a leaving scene (F51)", () => {
  // Bug: the next rest released what the scene before named while its elements still played their exit.
  it("holds what the scene before named while anything carries Exiting, at a rest too", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "board.chains") });

    mock.connect();
    await mock.start();
    await mock.api.load("board.chains");
    mock.api.sceneBundles(["board.chains"]);
    mock.world.exiting = [7];
    mock.api.sceneBundles(["board"]);
    releaseLeftBundles(mock.assetsCtx);

    expect(mock.ctx.state.sceneLeaving).toEqual(["board.chains"]);
    expect(mock.api.isLoaded("board.chains")).toBe(true);
  });

  it("lets a leave bundle go at once when the last exit ends, and keeps a budget bundle", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "board.chains") });

    mock.connect();
    await mock.start();
    await mock.api.load("board");
    await mock.api.load("board.chains");
    mock.api.sceneBundles(["board", "board.chains"]);
    mock.world.exiting = [7, 8];
    mock.api.sceneBundles([]);

    // One element still leaves: nothing goes.
    mock.world.endExit(7);
    expect(mock.api.isLoaded("board.chains")).toBe(true);

    mock.world.endExit(8);
    expect(mock.ctx.state.sceneLeaving).toEqual([]);
    expect(mock.api.isLoaded("board.chains")).toBe(false);
    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("keeps a name the next list takes back: it is the mounted scene's again", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "board.chains") });

    mock.connect();
    await mock.start();
    await mock.api.load("board.chains");
    mock.api.sceneBundles(["board.chains"]);
    mock.world.exiting = [7];
    mock.api.sceneBundles([]);
    mock.api.sceneBundles(["board.chains"]);
    mock.world.endExit(7);

    expect(mock.ctx.state.sceneLeaving).toEqual([]);
    expect(mock.api.isLoaded("board.chains")).toBe(true);
  });
});

describe("companions.add", () => {
  it("calls the companion on every load until its remover ran, and a second removal does nothing", async () => {
    const mock = createMockAssets({ manifest });
    const companion = { load: vi.fn(async () => undefined), unload: vi.fn() };
    const other = { load: vi.fn(async () => undefined), unload: vi.fn() };

    await mock.start();

    const remove = mock.api.companions.add(companion);

    mock.api.companions.add(other);
    await mock.api.load("board");
    remove();
    remove();
    await mock.api.load("board.chains");

    expect(companion.load.mock.calls).toEqual([["board"]]);
    expect(other.load.mock.calls).toEqual([["board"], ["board.chains"]]);
  });
});

describe("has", () => {
  it("answers from the manifest, live and headless alike", async () => {
    const live = createMockAssets({ manifest });
    const headless = createMockAssets({ manifest, io: undefined });

    await live.start();
    await headless.start();

    for (const mock of [live, headless]) {
      expect(mock.api.has("board.chains")).toBe(true);
      expect(mock.api.has("ep99")).toBe(false);
      expect(mock.api.has("toString")).toBe(false);
    }

    expect(live.api.isLoaded("board.chains")).toBe(false);
  });
});
