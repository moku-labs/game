import { describe, expect, it } from "vitest";
import { enforceBudget, pickVictim, unloadBundle, usedMb } from "../../budget";
import { loadBundle } from "../../tiers";
import type { MockAssets } from "./mock-assets";
import { createMockAssets, manifestOf } from "./mock-assets";

const manifest = manifestOf({
  ui: { feature: "ui", tier: "core", keys: ["ui.panel"] },
  alpha: { feature: "alpha", tier: "scene", keys: ["alpha.one"] },
  beta: { feature: "beta", tier: "scene", keys: ["beta.one"] },
  gamma: { feature: "gamma", tier: "scene", keys: ["gamma.one"] }
});

/**
 * Loads three scene bundles and the core bundle, then stamps a use order on them.
 *
 * @returns The mock with four loaded bundles.
 */
async function loadAll(): Promise<MockAssets> {
  const mock = createMockAssets({ manifest, textureBudgetMb: 10 });

  await mock.start();

  for (const name of ["ui", "alpha", "beta", "gamma"]) {
    await loadBundle(mock.assetsCtx, name, undefined, "request");
  }

  return mock;
}

describe("usedMb", () => {
  it("sums the loaded bundles only", async () => {
    const mock = await loadAll();

    expect(usedMb(mock.ctx.state)).toBeCloseTo(0.252, 3);

    unloadBundle(mock.assetsCtx, "alpha", "request");

    expect(usedMb(mock.ctx.state)).toBeCloseTo(0.189, 3);
  });
});

describe("pickVictim", () => {
  it("takes the loaded bundle with the smallest use counter", async () => {
    const mock = await loadAll();

    expect(pickVictim(mock.ctx.state)).toBe("alpha");
  });

  it("never takes a permanent tier", async () => {
    const mock = await loadAll();

    unloadBundle(mock.assetsCtx, "alpha", "request");
    unloadBundle(mock.assetsCtx, "beta", "request");
    unloadBundle(mock.assetsCtx, "gamma", "request");

    expect(pickVictim(mock.ctx.state)).toBeUndefined();
  });

  it("never takes a pinned bundle", async () => {
    const mock = await loadAll();

    mock.ctx.state.pinned = new Set(["alpha"]);

    expect(pickVictim(mock.ctx.state)).toBe("beta");
  });

  it("never takes a bundle of the preload queue", async () => {
    const mock = await loadAll();

    mock.ctx.state.queue = { bundles: ["alpha", "beta"], controller: new AbortController() };

    expect(pickVictim(mock.ctx.state)).toBe("gamma");
  });
});

describe("unloadBundle", () => {
  it("destroys the textures, invalidates the keys and emits the event", async () => {
    const mock = await loadAll();
    const destroyed = mock.io.destroyed.length;

    unloadBundle(mock.assetsCtx, "alpha", "request");

    expect(mock.io.destroyed).toHaveLength(destroyed + 1);
    expect(mock.renderer.invalidated.at(-1)).toEqual(["alpha.one"]);
    expect(mock.emitted.at(-1)).toEqual({
      name: "assets:bundle-unloaded",
      payload: { bundle: "alpha", tier: "scene", mb: 0.063, reason: "request" }
    });
    expect(mock.ctx.state.records.get("alpha")?.status).toBe("idle");
  });

  it("does nothing for a bundle that is not loaded", async () => {
    const mock = await loadAll();

    unloadBundle(mock.assetsCtx, "alpha", "request");
    const emitted = mock.emitted.length;

    unloadBundle(mock.assetsCtx, "alpha", "request");

    expect(mock.emitted).toHaveLength(emitted);
  });
});

describe("enforceBudget", () => {
  it("unloads the least recently used bundles until the budget holds", async () => {
    const mock = await loadAll();

    mock.config.textureBudgetMb = 0.13;
    enforceBudget(mock.assetsCtx);

    expect(mock.ctx.state.records.get("alpha")?.status).toBe("idle");
    expect(mock.ctx.state.records.get("beta")?.status).toBe("idle");
    expect(mock.ctx.state.records.get("gamma")?.status).toBe("loaded");
    expect(usedMb(mock.ctx.state)).toBeCloseTo(0.126, 3);
  });

  it("reports the reason budget on every eviction", async () => {
    const mock = await loadAll();

    mock.config.textureBudgetMb = 0.2;
    enforceBudget(mock.assetsCtx);

    expect(mock.emitted.at(-1)).toMatchObject({
      name: "assets:bundle-unloaded",
      payload: { bundle: "alpha", reason: "budget" }
    });
  });

  it("does nothing while the budget holds", async () => {
    const mock = await loadAll();
    const emitted = mock.emitted.length;

    enforceBudget(mock.assetsCtx);

    expect(mock.emitted).toHaveLength(emitted);
  });

  it("warns with the heaviest files when no bundle may go", async () => {
    const mock = await loadAll();

    mock.ctx.state.pinned = new Set(["alpha", "beta", "gamma"]);
    mock.config.textureBudgetMb = 0.01;
    enforceBudget(mock.assetsCtx);

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: over the texture budget with nothing to unload",
      expect.objectContaining({ budgetMb: 0.01, heaviest: expect.any(Array) })
    );
  });

  it("does nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined, textureBudgetMb: 0 });

    await mock.start();
    enforceBudget(mock.assetsCtx);

    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});
