import { describe, expect, it } from "vitest";
import type { NodeInfo } from "../../../flow/types";
import { load } from "../../bundles";
import { releaseAll } from "../../lifecycle";
import { loadBundle } from "../../tiers";
import type { LoadResult } from "../../types";
import { createMockAssets, manifestOf } from "./mock-assets";

const manifest = manifestOf({
  boot: { feature: "ui", tier: "boot", keys: ["ui.logo"] },
  board: { feature: "board", tier: "scene", keys: ["board.cell"] },
  "board.chains": { feature: "board", tier: "feature", keys: ["board.chain"] },
  "board.lazy": { feature: "board", tier: "lazy", keys: ["board.spark"] }
});

const boardNode: NodeInfo = {
  path: "board/await",
  flow: "board",
  node: "await",
  rest: true,
  over: false,
  checkpoint: false,
  barrier: false,
  scene: "board"
};

/**
 * Lets the microtask queue run.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("connectAssets", () => {
  it("registers the enter callback, the load handler and the texture provider", () => {
    const mock = createMockAssets({ manifest });

    mock.connect();

    expect(mock.flow.enter.map(entry => entry.stage)).toEqual(["load"]);
    expect(mock.flow.handlers.get("load")?.runInFast).toBe(true);
    expect(mock.renderer.providers).toHaveLength(1);
    expect(mock.ctx.state.removers).toHaveLength(3);
  });

  it("answers the renderer's provider with a loaded texture", async () => {
    const mock = createMockAssets({ manifest });

    mock.connect();
    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(mock.renderer.providers[0]?.("board.cell")).toBeDefined();
    expect(mock.renderer.providers[0]?.("board.nothing")).toBeUndefined();
  });
});

describe("startAssets", () => {
  it("reads the scenes and the flows of every feature", async () => {
    const mock = createMockAssets({ manifest });

    mock.flow.features.push({
      name: "board",
      description: {
        scenes: [{ id: "board", bundle: "board" }],
        flows: [{ id: "boardFlow" }],
        assets: { kind: "bundles", map: { board: { tier: "scene" } } }
      } as never
    });

    await mock.start();

    expect(mock.ctx.state.bundleOfScene.get("board")).toBe("board");
    expect(mock.ctx.state.featureOfFlow.get("boardFlow")).toBe("board");
    expect(mock.ctx.state.bundleOfKey.get("board.cell")).toBe("board");
  });

  it("awaits the boot tier and leaves the other tiers alone", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();

    expect(mock.ctx.state.records.get("boot")?.status).toBe("loaded");
    expect(mock.ctx.state.records.get("board")).toBeUndefined();
  });

  it("stays headless when no io is given and the renderer does not draw", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    await mock.start();

    expect(mock.ctx.state.io).toBeUndefined();
    expect(mock.ctx.state.records.size).toBe(0);
  });

  it("builds the default io out of the renderer when it draws", async () => {
    const mock = createMockAssets({ manifest: { version: 1, bundles: {} }, io: undefined });

    mock.renderer.ready = true;
    await mock.start();

    expect(mock.ctx.state.io).toBeDefined();
    expect(mock.ctx.state.io?.createTexture).toBeTypeOf("function");
  });
});

/**
 * Creates the mock with one feature that owns the scene "board" and the flow "board".
 *
 * @param options - Config overrides.
 * @returns The started mock, already connected.
 */
async function withBoardFeature(
  options: Parameters<typeof createMockAssets>[0] = {}
): Promise<ReturnType<typeof createMockAssets>> {
  const mock = createMockAssets({ manifest, ...options });

  mock.flow.features.push({
    name: "board",
    description: {
      scenes: [{ id: "board", bundle: "board" }],
      flows: [{ id: "board" }]
    } as never
  });
  mock.connect();
  await mock.start();

  return mock;
}

describe("the enter callback", () => {
  it("pins the bundles of the node and loads them", async () => {
    const mock = await withBoardFeature();
    const entry = mock.flow.enter[0];

    await entry?.callback(boardNode, { mode: "live", signal: new AbortController().signal });

    expect([...mock.ctx.state.pinned]).toEqual(["board", "board.chains"]);
    expect(mock.ctx.state.sceneBundle).toBe("board");
    expect(mock.ctx.state.current).toBe(boardNode);
    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.log.warn).toHaveBeenCalledWith("assets: the node waited for a bundle", {
      bundle: "board",
      path: "board/await"
    });
  });

  it("records the pins but awaits nothing in fast mode", async () => {
    const mock = await withBoardFeature();
    const entry = mock.flow.enter[0];

    await entry?.callback(boardNode, { mode: "fast", signal: new AbortController().signal });

    expect([...mock.ctx.state.pinned]).toEqual(["board", "board.chains"]);
    expect(mock.api.isLoaded("board")).toBe(false);
  });
});

describe("the load effect", () => {
  it("loads the bundles of the payload and reports what it cost", async () => {
    const mock = createMockAssets({ manifest });

    mock.connect();
    await mock.start();

    const handler = mock.flow.handlers.get("load");
    const result = (await handler?.run(load(["board", "board.chains"]), {
      signal: new AbortController().signal,
      mode: "live"
    })) as LoadResult;

    expect(result).toEqual({ loaded: ["board", "board.chains"], mb: 0.126 });
  });

  it("resolves empty while headless", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    mock.connect();
    await mock.start();

    const handler = mock.flow.handlers.get("load");
    const result = (await handler?.run(load("board"), {
      signal: new AbortController().signal,
      mode: "live"
    })) as LoadResult;

    expect(result).toEqual({ loaded: [], mb: 0 });
  });

  it("ignores a descriptor without bundles", async () => {
    const mock = createMockAssets({ manifest });

    mock.connect();
    await mock.start();

    const handler = mock.flow.handlers.get("load");
    const result = (await handler?.run(
      { kind: "load" },
      { signal: new AbortController().signal, mode: "live" }
    )) as LoadResult;

    expect(result).toEqual({ loaded: [], mb: 0 });
  });
});

describe("releaseAll", () => {
  it("destroys every texture, runs the removers and clears the registries", async () => {
    const mock = createMockAssets({ manifest });

    mock.connect();
    await mock.start();
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    const created = mock.io.created.length;

    releaseAll(mock.ctx.state);

    expect(mock.io.destroyed).toHaveLength(created);
    expect(mock.ctx.state.records.size).toBe(0);
    expect(mock.ctx.state.removers).toEqual([]);
    expect(mock.flow.enter).toEqual([]);
    expect(mock.renderer.providers).toEqual([]);
    expect(mock.ctx.state.io).toBeUndefined();
  });

  it("aborts a running load and the preload queue", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.io.control.gated = true;

    const running = loadBundle(mock.assetsCtx, "board", undefined, "request");
    const failed = running.catch((error: unknown) => (error as Error).name);

    await tick();
    releaseAll(mock.ctx.state);

    expect(await failed).toBe("AbortError");
  });
});

describe("reading the feature descriptions", () => {
  it("ignores a key that is not a list and an entry of the wrong shape", async () => {
    const mock = createMockAssets({ manifest });

    mock.flow.features.push(
      {
        name: "board",
        description: { scenes: { id: "board", bundle: "board" }, flows: "boardFlow" } as never
      },
      {
        name: "other",
        description: {
          scenes: ["board", 7, { bundle: "board" }, { id: "shop" }],
          flows: [7, { name: "x" }]
        } as never
      }
    );

    await mock.start();

    expect(mock.ctx.state.bundleOfScene.size).toBe(0);
    expect(mock.ctx.state.featureOfFlow.size).toBe(0);
  });
});

describe("the load effect on a broken descriptor", () => {
  it("ignores a payload that is not an object and a bundles key that is not a list", async () => {
    const mock = createMockAssets({ manifest });

    mock.connect();
    await mock.start();

    const handler = mock.flow.handlers.get("load");
    const run = { signal: new AbortController().signal, mode: "live" as const };

    await expect(handler?.run({ kind: "load", payload: 7 }, run)).resolves.toEqual({
      loaded: [],
      mb: 0
    });
    await expect(
      handler?.run({ kind: "load", payload: { bundles: "board" } }, run)
    ).resolves.toEqual({ loaded: [], mb: 0 });
    await expect(
      handler?.run({ kind: "load", payload: { bundles: [7, "board"] } }, run)
    ).resolves.toEqual({ loaded: ["board"], mb: 0.063 });
  });
});

describe("releaseAll when nothing was loaded", () => {
  it("clears a headless plugin without asking for a texture", async () => {
    const mock = createMockAssets({ manifest, io: undefined });

    mock.connect();
    await mock.start();
    releaseAll(mock.ctx.state);

    expect(mock.io.destroyed).toEqual([]);
    expect(mock.flow.enter).toEqual([]);
    expect(mock.ctx.state.bundleOfKey.size).toBe(0);
  });
});
