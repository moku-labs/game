import { describe, expect, it } from "vitest";
import { lookupTexture } from "../../api";
import { loadBundle } from "../../tiers";
import { createMockAssets, manifestOf } from "./mock-assets";

const manifest = manifestOf({
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] },
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] },
  "board.chains": { feature: "board", tier: "lazy", keys: ["board.chain"] }
});

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
