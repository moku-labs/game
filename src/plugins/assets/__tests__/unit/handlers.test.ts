import { describe, expect, it } from "vitest";
import type { NodeInfo } from "../../../flow/types";
import { createHandlers } from "../../handlers";
import { loadBundle } from "../../tiers";
import { createMockAssets, manifestOf } from "./mock-assets";

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
  it("declares the one hook the plugin listens to", () => {
    const mock = createMockAssets({ manifest });

    expect(Object.keys(createHandlers(mock.ctx))).toEqual(["flow:rest"]);
  });

  it("rebuilds the preload queue at a rest node", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.flow.graph = graph as never;
    mock.ctx.state.bundleOfScene = new Map([
      ["alpha", "alpha"],
      ["beta", "beta"]
    ]);
    mock.ctx.state.current = alphaNode;

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
