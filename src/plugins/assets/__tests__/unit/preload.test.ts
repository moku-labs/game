import { describe, expect, it } from "vitest";
import type { GraphNode } from "../../../flow/runner/types";
import type { FlowGraph, NodeInfo } from "../../../flow/types";
import { createHandlers } from "../../handlers";
import { bundlesOfNode, neighbourhood, startPreload, stopPreload } from "../../preload";
import { loadBundle } from "../../tiers";
import type { MockAssets } from "./mock-assets";
import { createMockAssets, manifestOf } from "./mock-assets";

const manifest = manifestOf({
  home: { feature: "ui", tier: "scene", keys: ["ui.home"] },
  board: { feature: "board", tier: "scene", keys: ["board.cell"] },
  "board.chains": { feature: "board", tier: "feature", keys: ["board.chain"] },
  "board.lazy": { feature: "board", tier: "lazy", keys: ["board.spark"] },
  shop: { feature: "shop", tier: "scene", keys: ["shop.coin"] },
  reward: { feature: "reward", tier: "scene", keys: ["reward.star"] }
});

/**
 * Builds one node of `describe()`.
 *
 * @param flow - Flow the node belongs to.
 * @param node - Node name.
 * @param extra - Scene, sub-flow or slot of the node.
 * @returns The graph node.
 */
function graphNode(flow: string, node: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    flow,
    node,
    rest: false,
    over: false,
    checkpoint: false,
    barrier: false,
    outcomes: [],
    ...extra
  };
}

const graph: FlowGraph = {
  main: "main",
  flows: {
    main: {
      start: "home",
      nodes: {
        home: graphNode("main", "home", { rest: true, scene: "home", outcomes: ["play"] }),
        board: graphNode("main", "board", { subFlow: "board", outcomes: ["left"] }),
        shop: graphNode("main", "shop", { scene: "shop", outcomes: ["done"] })
      },
      edges: { home: { play: "board" }, board: { left: "shop" }, shop: { done: "home" } }
    },
    board: {
      start: "await",
      nodes: {
        await: graphNode("board", "await", {
          rest: true,
          scene: "board",
          outcomes: ["merge", "leave"]
        }),
        merge: graphNode("board", "merge", { outcomes: ["done"] }),
        extra: graphNode("board", "extra", { slot: "afterMerge", outcomes: ["done"] })
      },
      edges: {
        await: { merge: "merge", leave: "exit:left" },
        merge: { done: "map:extra" },
        extra: { done: "await" }
      }
    },
    reward: {
      start: "show",
      nodes: { show: graphNode("reward", "show", { scene: "reward", outcomes: ["done"] }) },
      edges: { show: { done: "exit:done" } }
    }
  },
  slots: { afterMerge: [{ feature: "reward", flow: "reward", order: 10 }] }
};

/**
 * Creates the mock, fills the scene and flow registries and stands on a node.
 *
 * @param at - Where the graph stands.
 * @param at.flow - Flow of the current node.
 * @param at.node - Name of the current node.
 * @param at.scene - Scene of the current node.
 * @param stack - The frames of `flow.state()`, outermost first.
 * @returns The prepared mock.
 */
async function standingAt(
  at: { flow: string; node: string; scene?: string },
  stack: Array<{ flow: string; node: string }> = []
): Promise<MockAssets> {
  const mock = createMockAssets({ manifest, preloadDepth: 2 });

  await mock.start();

  mock.flow.graph = graph;
  mock.flow.stack = stack.map(frame => ({ ...frame, input: 0 }));
  mock.ctx.state.bundleOfScene = new Map([
    ["home", "home"],
    ["board", "board"],
    ["shop", "shop"],
    ["reward", "reward"]
  ]);
  mock.ctx.state.featureOfFlow = new Map([
    ["main", "ui"],
    ["board", "board"],
    ["reward", "reward"]
  ]);
  mock.ctx.state.current = {
    path: `${at.flow}/${at.node}`,
    flow: at.flow,
    node: at.node,
    rest: true,
    over: false,
    checkpoint: false,
    barrier: false,
    ...(at.scene === undefined ? {} : { scene: at.scene })
  } as NodeInfo;

  return mock;
}

describe("bundlesOfNode", () => {
  it("takes the scene bundle and the feature-tier bundles of the node's flow", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" });

    expect(bundlesOfNode(mock.assetsCtx, mock.ctx.state.current as NodeInfo)).toEqual([
      "board",
      "board.chains"
    ]);
  });

  it("keeps the previous scene bundle for a node without a scene", async () => {
    const mock = await standingAt({ flow: "board", node: "merge" });

    mock.ctx.state.sceneBundle = "board";

    expect(bundlesOfNode(mock.assetsCtx, mock.ctx.state.current as NodeInfo)).toEqual([
      "board",
      "board.chains"
    ]);
  });

  it("skips a scene whose bundle is unknown", async () => {
    const mock = await standingAt({ flow: "main", node: "home", scene: "nowhere" });

    expect(bundlesOfNode(mock.assetsCtx, mock.ctx.state.current as NodeInfo)).toEqual([]);
  });
});

describe("neighbourhood", () => {
  it("gives only the bundles of the current node at depth 0", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    expect(neighbourhood(mock.assetsCtx, 0)).toEqual(["board", "board.chains"]);
  });

  it("follows an exit through the frame stack", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    expect(neighbourhood(mock.assetsCtx, 1)).toEqual(["board", "board.chains", "shop"]);
  });

  it("follows a sub-flow at the same distance", async () => {
    const mock = await standingAt({ flow: "main", node: "home", scene: "home" }, [
      { flow: "main", node: "home" }
    ]);

    expect(neighbourhood(mock.assetsCtx, 1)).toEqual(["home", "board", "board.chains"]);
  });

  it("follows a slot and a mapped edge at depth 2", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual([
      "board",
      "board.chains",
      "shop",
      "home",
      "reward"
    ]);
  });

  it("never offers a lazy bundle", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" });

    expect(neighbourhood(mock.assetsCtx, 2)).not.toContain("board.lazy");
  });

  it("skips what is already loaded", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(neighbourhood(mock.assetsCtx, 1)).toEqual(["board.chains", "shop"]);
  });

  it("stops at the first bundle that would break the budget", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    mock.config.textureBudgetMb = 0.1;

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual(["board"]);
  });
});

describe("startPreload", () => {
  it("loads the neighbourhood one bundle after another", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    startPreload(mock.assetsCtx);

    expect(mock.ctx.state.queue?.bundles).toEqual([
      "board",
      "board.chains",
      "shop",
      "home",
      "reward"
    ]);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mock.ctx.state.records.get("reward")?.status).toBe("loaded");
    expect(mock.emitted.filter(entry => entry.name === "assets:bundle-loaded")).toHaveLength(5);
  });

  it("replaces the running queue and aborts the old one when the neighbourhood changed", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    mock.io.control.gated = true;
    startPreload(mock.assetsCtx);

    const first = mock.ctx.state.queue;

    // The graph left the board for home: another neighbourhood, so another queue.
    mock.flow.stack = [{ flow: "main", node: "home", input: 0 }];
    mock.ctx.state.current = {
      path: "main/home",
      flow: "main",
      node: "home",
      rest: true,
      over: false,
      checkpoint: false,
      barrier: false,
      scene: "home"
    } as NodeInfo;
    startPreload(mock.assetsCtx);

    expect(first?.controller.signal.aborted).toBe(true);
    expect(mock.ctx.state.queue).not.toBe(first);
    expect(mock.ctx.state.queue?.bundles[0]).toBe("home");

    stopPreload(mock.ctx.state);
    mock.io.releaseAll();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("does nothing at depth 0", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" });

    mock.config.preloadDepth = 0;
    startPreload(mock.assetsCtx);

    expect(mock.ctx.state.queue).toBeUndefined();
  });

  it("does nothing while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();
    startPreload(mock.assetsCtx);

    expect(mock.ctx.state.queue).toBeUndefined();
  });
});

describe("startPreload on a rest node the graph comes back to", () => {
  it("keeps the running queue for the same neighbourhood, so its load finishes once", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);
    const rest = createHandlers(mock.ctx)["flow:rest"];

    mock.io.control.gated = true;
    rest({ path: "board/await", checkpoint: false });

    const first = mock.ctx.state.queue;

    // The first bundle of the queue is in flight when the same rest node comes back.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mock.ctx.state.records.get("board")?.status).toBe("loading");
    rest({ path: "board/await", checkpoint: false });

    expect(mock.ctx.state.queue).toBe(first);
    expect(first?.controller.signal.aborted).toBe(false);

    mock.io.control.gated = false;
    mock.io.releaseAll();
    await new Promise(resolve => setTimeout(resolve, 0));

    const loaded = mock.emitted
      .filter(entry => entry.name === "assets:bundle-loaded")
      .map(entry => (entry.payload as { bundle: string }).bundle);

    expect(loaded.filter(name => name === "board")).toHaveLength(1);
    expect(mock.io.fetched.filter(url => url === "/features/board/assets/cell.png")).toHaveLength(
      1
    );
    expect(mock.ctx.state.records.get("reward")?.status).toBe("loaded");
  });
});

describe("stopPreload", () => {
  it("aborts the queue and forgets it", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" });

    mock.io.control.gated = true;
    startPreload(mock.assetsCtx);

    const queue = mock.ctx.state.queue;

    stopPreload(mock.ctx.state);

    expect(queue?.controller.signal.aborted).toBe(true);
    expect(mock.ctx.state.queue).toBeUndefined();

    mock.io.releaseAll();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

describe("the walk on a broken graph", () => {
  it("gives nothing when the graph stands nowhere", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" });

    mock.ctx.state.current = undefined;

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual([]);
  });

  it("gives nothing when the current node is not in the description", async () => {
    const mock = await standingAt({ flow: "nowhere", node: "gone" });

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual([]);
  });

  it("stops at an exit with no parent frame", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, []);

    expect(neighbourhood(mock.assetsCtx, 1)).toEqual(["board", "board.chains"]);
  });

  it("stops at an exit the parent has no edge for", async () => {
    const mock = await standingAt({ flow: "reward", node: "show", scene: "reward" }, [
      { flow: "board", node: "merge" },
      { flow: "reward", node: "show" }
    ]);

    expect(neighbourhood(mock.assetsCtx, 1)).toEqual(["reward", "board.chains"]);
  });

  it("skips a sub-flow and a slot the description does not carry", async () => {
    const mock = await standingAt({ flow: "main", node: "home", scene: "home" });

    mock.flow.graph = {
      main: "main",
      flows: {
        main: {
          start: "home",
          nodes: {
            home: graphNode("main", "home", {
              rest: true,
              scene: "home",
              subFlow: "gone",
              slot: "empty"
            })
          },
          edges: {}
        }
      },
      slots: {}
    };

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual(["home"]);
  });

  it("skips an edge target that names no node", async () => {
    const mock = await standingAt({ flow: "main", node: "home", scene: "home" });

    mock.flow.graph = {
      main: "main",
      flows: {
        main: {
          start: "home",
          nodes: { home: graphNode("main", "home", { rest: true, scene: "home" }) },
          edges: { home: { play: "gone" } }
        }
      },
      slots: {}
    };

    expect(neighbourhood(mock.assetsCtx, 2)).toEqual(["home"]);
  });
});

describe("the preload queue when a bundle breaks", () => {
  it("logs the failure and loads the rest of the queue", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    mock.io.status.set("/features/board/assets/cell.png", 500);
    startPreload(mock.assetsCtx);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mock.log.warn).toHaveBeenCalledWith(
      "assets: a preloaded bundle failed",
      expect.objectContaining({ bundle: "board" })
    );
    expect(mock.ctx.state.records.get("reward")?.status).toBe("loaded");
  });

  it("stops the queue as soon as it is aborted", async () => {
    const mock = await standingAt({ flow: "board", node: "await", scene: "board" }, [
      { flow: "main", node: "board" },
      { flow: "board", node: "await" }
    ]);

    mock.io.control.gated = true;
    startPreload(mock.assetsCtx);

    const queue = mock.ctx.state.queue;

    stopPreload(mock.ctx.state);
    mock.io.releaseAll();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(queue?.controller.signal.aborted).toBe(true);
    expect(mock.ctx.state.records.get("reward")?.status).not.toBe("loaded");
  });
});
