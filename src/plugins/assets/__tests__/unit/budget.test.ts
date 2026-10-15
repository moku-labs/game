import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceBudget, pickVictim, releaseLeftBundles, unloadBundle, usedMb } from "../../budget";
import { loadBundle } from "../../tiers";
import type { MockAssets } from "./mock-assets";
import { createMockAssets, graphOf, leaving, manifestOf, packedManifest } from "./mock-assets";

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

describe("unloadBundle in the performance log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the unload in an agent build, and nowhere without the flag", async () => {
    const plain = await loadAll();

    unloadBundle(plain.assetsCtx, "alpha", "request");

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const agent = await loadAll();

    vi.mocked(agent.renderer.api.monitor.event).mockClear();
    unloadBundle(agent.assetsCtx, "beta", "budget");

    expect(plain.renderer.api.monitor.event).not.toHaveBeenCalled();
    expect(agent.renderer.api.monitor.event).toHaveBeenCalledWith("bundle", {
      bundle: "beta",
      action: "unload",
      tier: "scene",
      mb: 0.063,
      reason: "budget"
    });
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
      payload: { bundle: "alpha", tier: "scene", mb: 0.063, reason: "request", keys: ["alpha.one"] }
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

describe("budget edge cases", () => {
  it("ignores a record whose bundle left the manifest", async () => {
    const mock = await loadAll();

    mock.ctx.state.manifest = { version: 1, bundles: {} };

    expect(usedMb(mock.ctx.state)).toBe(0);
    expect(pickVictim(mock.ctx.state)).toBeUndefined();
  });

  it("skips a bundle that is still loading", async () => {
    const mock = await loadAll();

    unloadBundle(mock.assetsCtx, "alpha", "request");
    mock.io.control.gated = true;

    const running = loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    const record = mock.ctx.state.records.get("alpha");

    expect(record?.status).toBe("loading");
    expect(pickVictim(mock.ctx.state)).toBe("beta");

    mock.io.releaseAll();
    await running;
  });

  it("frees the record without an io when the plugin is already headless", async () => {
    const mock = await loadAll();
    const destroyed = mock.io.destroyed.length;

    mock.ctx.state.io = undefined;
    unloadBundle(mock.assetsCtx, "alpha", "request");

    expect(mock.io.destroyed).toHaveLength(destroyed);
    expect(mock.ctx.state.records.get("alpha")?.status).toBe("idle");
    expect(mock.renderer.invalidated.at(-1)).toEqual(["alpha.one"]);
  });

  it("names the heaviest files by size and then by key", async () => {
    const mock = await loadAll();

    mock.ctx.state.pinned = new Set(["alpha", "beta", "gamma"]);
    mock.config.textureBudgetMb = 0;
    enforceBudget(mock.assetsCtx);

    const warned = (mock.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
    const data = warned?.[1] as { heaviest: Array<{ key: string }>; usedMb: number };

    expect(data.usedMb).toBe(0.252);
    expect(data.heaviest.map(entry => entry.key)).toEqual([
      "alpha.one",
      "beta.one",
      "gamma.one",
      "ui.panel"
    ]);
  });
});

/**
 * Loads the packed bundle of the mock.
 *
 * @returns The mock with the bundle `ui` loaded: one page, three slices, one loose texture.
 */
async function loadPacked(): Promise<MockAssets> {
  const mock = createMockAssets({ manifest: packedManifest() });

  await mock.start();
  await loadBundle(mock.assetsCtx, "ui", undefined, "request");

  return mock;
}

describe("a packed bundle", () => {
  it("unload destroys every slice and the loose texture, then the page", async () => {
    const mock = await loadPacked();
    const page = mock.io.created.find(texture => texture.from.includes("main-0"));
    const loose = mock.io.created.find(texture => texture.from.includes("ui.bg"));

    unloadBundle(mock.assetsCtx, "ui", "request");

    const ids = mock.io.destroyed.map(texture => texture.id);

    expect(ids.at(-1)).toBe(page?.id);
    expect(ids.slice(0, -1).toSorted()).toEqual([loose?.id, "s1", "s2", "s3"].toSorted());
    expect(mock.ctx.state.records.get("ui")?.pages.size).toBe(0);
    expect(mock.emitted.at(-1)).toMatchObject({
      name: "assets:bundle-unloaded",
      payload: { keys: ["ui.bg", "ui.icon-coin", "ui.icon-gear", "ui.panel"] }
    });
  });

  it("counts the bundle cost once, pages and loose files together", async () => {
    const mock = await loadPacked();

    expect(usedMb(mock.ctx.state)).toBeCloseTo(1.916, 3);
  });

  it("names a page among the heaviest entries, and no packed file", async () => {
    const mock = await loadPacked();

    mock.ctx.state.pinned = new Set(["ui"]);
    mock.config.textureBudgetMb = 0;
    enforceBudget(mock.assetsCtx);

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: over the texture budget with nothing to unload",
      expect.objectContaining({
        heaviest: [
          { key: 'page "ui/main-0"', mb: 1 },
          { key: "ui.bg", mb: 0.916 }
        ]
      })
    );
  });
});

describe("pickVictim and the scene list", () => {
  it("never takes a bundle the mounted scene names", async () => {
    const mock = await loadAll();

    mock.ctx.state.sceneNamed = ["alpha"];

    expect(pickVictim(mock.ctx.state)).toBe("beta");
  });

  it('takes a "leave" bundle like any other when nothing holds it', async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "alpha"), textureBudgetMb: 10 });

    await mock.start();

    for (const name of ["alpha", "beta"]) {
      await loadBundle(mock.assetsCtx, name, undefined, "request");
    }

    expect(pickVictim(mock.ctx.state)).toBe("alpha");
  });
});

/** The episode game: the parent `episodes`, its sub-feature `ep01`, and `home`. */
const episodes = leaving(
  manifestOf({
    ep01: { feature: "ep01", tier: "lazy", keys: ["ep01.room"] },
    home: { feature: "home", tier: "lazy", keys: ["home.bg"] },
    keeper: { feature: "ep01", tier: "lazy", keys: ["ep01.keep"] }
  }),
  "ep01",
  "home"
);

/**
 * Starts the episode game with `ep01`, `home` and the budget bundle `keeper` loaded. In the graph,
 * `pick` is a node of `episodes`, the sub-flow entry `ep01` and `play` belong to `ep01`, and the
 * home flow holds `shared`, a node `ep01` lists and contributes into it.
 *
 * @param stack - The frames of `flow.state()`, outermost first.
 * @returns The mock.
 */
async function episodeAt(stack: Array<{ flow: string; node: string }>): Promise<MockAssets> {
  const mock = createMockAssets({ manifest: episodes });

  await mock.start();

  for (const name of ["ep01", "home", "keeper"]) {
    await loadBundle(mock.assetsCtx, name, undefined, "request");
  }

  mock.flow.graph = graphOf({
    "home.main": { idle: { owner: "home" }, shared: { owner: "ep01" } },
    "episodes.pick": { pick: { owner: "episodes" }, ep01: { owner: "ep01" } },
    "ep01.play": { play: { owner: "ep01" } },
    "kit.look": { look: { owner: "kit" } }
  });
  mock.flow.stack = stack.map(frame => ({ ...frame, input: 0 }));
  mock.emitted.length = 0;

  return mock;
}

/**
 * The bundles of a mock that are loaded.
 *
 * @param mock - The mock plugin.
 * @returns Their names, sorted.
 */
function loaded(mock: MockAssets): string[] {
  return mock.api.usage().bundles.map(entry => entry.name);
}

describe("releaseLeftBundles", () => {
  it('unloads a loaded "leave" bundle nobody holds, with the reason "leave" and its keys', async () => {
    const mock = await episodeAt([{ flow: "episodes.pick", node: "pick" }]);

    releaseLeftBundles(mock.assetsCtx);

    expect(loaded(mock)).toEqual(["keeper"]);
    expect(mock.emitted).toContainEqual({
      name: "assets:bundle-unloaded",
      payload: { bundle: "ep01", tier: "lazy", mb: 0.063, reason: "leave", keys: ["ep01.room"] }
    });
  });

  it("keeps a pinned bundle and one the mounted scene names", async () => {
    const mock = await episodeAt([]);

    mock.ctx.state.pinned = new Set(["ep01"]);
    mock.ctx.state.sceneNamed = ["home"];
    releaseLeftBundles(mock.assetsCtx);

    expect(loaded(mock)).toEqual(["ep01", "home", "keeper"]);
  });

  it("keeps the bundle of a feature that owns the node of any frame, an outer one too", async () => {
    // The sub-flow entry of ep01 is the outer frame; the inner frame is a node of another feature.
    const mock = await episodeAt([
      { flow: "episodes.pick", node: "ep01" },
      { flow: "kit.look", node: "look" }
    ]);

    releaseLeftBundles(mock.assetsCtx);

    expect(loaded(mock)).toEqual(["ep01", "keeper"]);
  });

  it("keeps the bundle of the feature that lists a contributed node, not of the flow's feature", async () => {
    const mock = await episodeAt([{ flow: "home.main", node: "shared" }]);

    releaseLeftBundles(mock.assetsCtx);

    expect(loaded(mock)).toEqual(["ep01", "keeper"]);
  });

  it("leaves a loading bundle alone and does nothing headless", async () => {
    const mock = await episodeAt([]);

    unloadBundle(mock.assetsCtx, "ep01", "request");
    mock.io.control.gated = true;

    const running = loadBundle(mock.assetsCtx, "ep01", undefined, "request");

    releaseLeftBundles(mock.assetsCtx);

    expect(mock.ctx.state.records.get("ep01")?.status).toBe("loading");
    expect(mock.ctx.state.records.get("ep01")?.inflight?.controller.signal.aborted).toBe(false);

    mock.io.releaseAll();
    await running;
    // Without an io nothing was ever loaded for real, so nothing is released either.
    mock.ctx.state.io = undefined;
    releaseLeftBundles(mock.assetsCtx);

    expect(mock.ctx.state.records.get("ep01")?.status).toBe("loaded");
  });
});

describe("unloadBundle and the companions", () => {
  it("calls each companion's unload once, after the textures went and before the event", async () => {
    const mock = await loadAll();
    const seen: Array<{ bundle: string; destroyed: number; emitted: number }> = [];
    const note = (bundle: string): void => {
      seen.push({ bundle, destroyed: mock.io.destroyed.length, emitted: mock.emitted.length });
    };

    mock.api.companions.add({ load: async () => undefined, unload: note });
    mock.api.companions.add({ load: async () => undefined, unload: note });
    mock.emitted.length = 0;
    unloadBundle(mock.assetsCtx, "alpha", "budget");

    expect(seen).toEqual([
      { bundle: "alpha", destroyed: 1, emitted: 0 },
      { bundle: "alpha", destroyed: 1, emitted: 0 }
    ]);
    expect(mock.emitted.map(entry => entry.name)).toEqual(["assets:bundle-unloaded"]);
  });

  it("logs a companion whose unload throws and still calls the next one", async () => {
    const mock = await loadAll();
    const next = vi.fn();

    mock.api.companions.add({
      load: async () => undefined,
      unload: () => {
        throw new Error("strings are gone");
      }
    });
    mock.api.companions.add({ load: async () => undefined, unload: next });
    unloadBundle(mock.assetsCtx, "alpha", "request");

    expect(next).toHaveBeenCalledExactlyOnceWith("alpha");
    expect(mock.log.error).toHaveBeenCalledWith("assets: a companion failed to unload", {
      bundle: "alpha",
      error: "Error: strings are gone"
    });
  });
});
