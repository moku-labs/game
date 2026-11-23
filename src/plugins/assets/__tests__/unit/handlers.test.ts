import { describe, expect, it } from "vitest";
import type { NodeInfo } from "../../../flow/types";
import { createHandlers } from "../../handlers";
import { loadBundle } from "../../tiers";
import { createMockAssets, leaving, manifestOf, sceneOf } from "./mock-assets";

const manifest = manifestOf({
  alpha: { feature: "alpha", tier: "scene", keys: ["alpha.one"] },
  beta: { feature: "beta", tier: "scene", keys: ["beta.one"] }
});

const graph = {
  main: "main",
  flows: {
    main: {
      start: "alpha",
      nodes: {
        alpha: {
          flow: "main",
          node: "alpha",
          rest: true,
          over: false,
          checkpoint: false,
          barrier: false,
          scene: "alpha",
          outcomes: ["next"]
        },
        beta: {
          flow: "main",
          node: "beta",
          rest: true,
          over: false,
          checkpoint: false,
          barrier: false,
          scene: "beta",
          outcomes: ["back"]
        }
      },
      edges: { alpha: { next: "beta" }, beta: { back: "alpha" } }
    }
  },
  slots: {}
};

const alphaNode: NodeInfo = {
  path: "main/alpha",
  flow: "main",
  node: "alpha",
  rest: true,
  over: false,
  checkpoint: false,
  barrier: false,
  scene: "alpha"
};

/**
 * Lets the microtask queue run.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("createHandlers", () => {
  it("declares the two hooks the plugin listens to", () => {
    const mock = createMockAssets({ manifest });

    expect(Object.keys(createHandlers(mock.ctx))).toEqual(["flow:rest", "ui:hot-swap"]);
  });

  it("rebuilds the preload queue at a rest node", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.flow.graph = graph as never;
    mock.ctx.state.scenes = new Map([
      ["alpha", sceneOf("alpha", "alpha")],
      ["beta", sceneOf("beta", "beta")]
    ]);
    mock.ctx.state.current = alphaNode;

    // No frame source (plain Bun): no frame would ever come, so the walk runs at once.
    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.queue?.bundles).toEqual(["alpha", "beta"]);

    await tick();

    expect(mock.api.isLoaded("beta")).toBe(true);
  });

  it("skips the preload while the graph walks in fast mode", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.flow.graph = graph as never;
    mock.flow.mode = "fast";
    mock.ctx.state.current = alphaNode;

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.queue).toBeUndefined();
  });

  it("enforces the budget at a rest node", async () => {
    const mock = createMockAssets({ manifest, preloadDepth: 0 });

    await mock.start();
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    await loadBundle(mock.assetsCtx, "beta", undefined, "request");
    mock.config.textureBudgetMb = 0.07;
    mock.ctx.state.current = alphaNode;

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.api.isLoaded("alpha")).toBe(false);
    expect(mock.api.isLoaded("beta")).toBe(true);
  });

  it("does nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();
    mock.ctx.state.current = alphaNode;

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.queue).toBeUndefined();
  });
});

/**
 * A started mock resting on "alpha", its systems registered.
 *
 * @returns The mock.
 */
async function resting() {
  const mock = createMockAssets({ manifest });

  await mock.start();
  mock.connect();
  // A real frame source drives the loop: the walk waits for a frame.
  mock.time.running = true;
  mock.flow.graph = graph as never;
  mock.ctx.state.scenes = new Map([
    ["alpha", sceneOf("alpha", "alpha")],
    ["beta", sceneOf("beta", "beta")]
  ]);
  mock.ctx.state.current = alphaNode;

  return mock;
}

describe("the preload walk of a live rest, in a later frame while frames run (F230)", () => {
  // Bug caught: the walk runs in the task of the answer again, inside the commit frame of every merge.
  it("walks nothing in the rest's own task, nor in the first frame after it", async () => {
    const mock = await resting();

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.queue).toBeUndefined();

    mock.world.sync(0);

    expect(mock.ctx.state.queue).toBeUndefined();
  });

  // Bug caught: the walk lands in a frame of the merge's animation instead of after it.
  it("waits while the world still plays, and walks in the first frame it rests", async () => {
    const mock = await resting();

    mock.world.left = 120;
    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });
    mock.world.sync(0);
    mock.world.sync(200);

    expect(mock.ctx.state.queue).toBeUndefined();

    mock.world.left = Number.POSITIVE_INFINITY;
    mock.world.sync(216);

    expect(mock.ctx.state.queue?.bundles).toEqual(["alpha", "beta"]);
  });

  // Bug caught: a screen that never stops moving (a looping ring) never gets its neighbours preloaded.
  it("walks at 500 ms after the rest's first frame even when the world never rests", async () => {
    const mock = await resting();

    mock.world.left = 120;
    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });
    mock.world.sync(1000);
    mock.world.sync(1499);

    expect(mock.ctx.state.queue).toBeUndefined();

    mock.world.sync(1500);

    expect(mock.ctx.state.queue?.bundles).toEqual(["alpha", "beta"]);
  });

  // Bug caught: two quick rests walk twice, or the second rest restarts the wait of the first late.
  it("walks once for two rests before its frame", async () => {
    const mock = await resting();
    const handlers = createHandlers(mock.ctx);

    handlers["flow:rest"]({ path: "main/alpha", checkpoint: false });
    handlers["flow:rest"]({ path: "main/alpha", checkpoint: false });
    mock.world.sync(0);
    mock.world.sync(16);
    const first = mock.ctx.state.queue;

    mock.world.sync(32);

    expect(first?.bundles).toEqual(["alpha", "beta"]);
    expect(mock.ctx.state.queue).toBe(first);
  });
});

describe("the release mark of a rest", () => {
  it("marks a live rest and releases nothing by itself", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "alpha"), preloadDepth: 0 });

    await mock.start();
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    mock.ctx.state.current = alphaNode;

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.restPending).toBe(true);
    // The preload had its chance: a bundle the next node waits for is warned from now on (F117).
    expect(mock.ctx.state.restedLive).toBe(true);
    expect(mock.api.isLoaded("alpha")).toBe(true);
  });

  it("marks no fast rest and still enforces the budget there", async () => {
    const mock = createMockAssets({ manifest: leaving(manifest, "alpha"), preloadDepth: 0 });

    await mock.start();
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    await loadBundle(mock.assetsCtx, "beta", undefined, "request");
    mock.config.textureBudgetMb = 0.07;
    mock.flow.mode = "fast";
    mock.ctx.state.current = alphaNode;

    createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.restPending).toBe(false);
    // A restore walks fast: its rests run no preload, so the node it restores is not warned (F117).
    expect(mock.ctx.state.restedLive).toBe(false);
    expect(mock.api.isLoaded("alpha")).toBe(false);
    expect(mock.api.isLoaded("beta")).toBe(true);
  });
});

describe("the hold of a bundle a node rests on through ready (F190)", () => {
  // Bug: after Back from the wait the hold never ended, so the bundle stayed out of the budget and the leave release.
  it("keeps the bundle from the budget through the first live rest and lets it go at the second", async () => {
    const mock = createMockAssets({ manifest, preloadDepth: 0 });
    const rest = createHandlers(mock.ctx)["flow:rest"];

    await mock.start();
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    // Alpha alone is over the budget: only the hold keeps it.
    mock.config.textureBudgetMb = 0.03;
    mock.ctx.state.current = alphaNode;
    // A ready answered false for alpha: a node rests on it.
    mock.ctx.state.readyWaiting.set("alpha", 0);

    rest({ path: "main/wait", checkpoint: false });

    expect(mock.api.isLoaded("alpha")).toBe(true);

    rest({ path: "main/alpha", checkpoint: false });

    expect(mock.ctx.state.readyWaiting.has("alpha")).toBe(false);
    expect(mock.api.isLoaded("alpha")).toBe(false);
  });
});
