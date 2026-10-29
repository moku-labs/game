import { describe, expect, it, vi } from "vitest";
import type { NodeInfo } from "../../../flow/types";
import { load } from "../../bundles";
import { createHandlers } from "../../handlers";
import { releaseAll } from "../../lifecycle";
import { loadBundle } from "../../tiers";
import type { LoadResult } from "../../types";
import {
  createMockAssets,
  graphOf,
  leaving,
  type MockAssets,
  manifestOf,
  sceneOf
} from "./mock-assets";

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
  it("registers the enter callback, the load and ready handlers, the texture provider, the exits of the world and assets.leave", () => {
    const mock = createMockAssets({ manifest });

    mock.connect();

    expect(mock.flow.enter.map(entry => entry.stage)).toEqual(["load"]);
    expect(mock.flow.handlers.get("load")?.runInFast).toBe(true);
    // Bug: a fast walk to a rest point skips `ready` and answers otherwise than the live game (F52).
    expect(mock.flow.handlers.get("ready")?.runInFast).toBe(true);
    expect(mock.renderer.providers).toHaveLength(1);
    expect(mock.ctx.state.removers).toHaveLength(7);
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
        scenes: [sceneOf("board", "board")],
        flows: [{ id: "boardFlow" }],
        assets: { kind: "bundles", map: { board: { tier: "scene" } } }
      } as never
    });

    await mock.start();

    expect(mock.ctx.state.scenes.get("board")?.bundle).toBe("board");
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
      scenes: [sceneOf("board", "board")],
      flows: [{ id: "board" }]
    } as never
  });
  mock.connect();
  await mock.start();

  return mock;
}

describe("the enter callback", () => {
  it("pins the bundles of the node and loads them, naming a bundle the preload of a live rest missed", async () => {
    const mock = await withBoardFeature();
    const entry = mock.flow.enter[0];

    mock.ctx.state.restedLive = true;
    await entry?.callback(boardNode, { mode: "live", signal: new AbortController().signal });

    expect([...mock.ctx.state.pinned]).toEqual(["board", "board.chains"]);
    expect(mock.ctx.state.sceneId).toBe("board");
    expect(mock.ctx.state.current).toBe(boardNode);
    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.log.warn).toHaveBeenCalledWith("assets: the node waited for a bundle", {
      bundle: "board",
      path: "board/await"
    });
  });

  // Bug (F117): the first node of a cold page or a restore had no rest before it, so no preload, and was warned.
  it("names no bundle the first node of a page waits for: no live rest ran a preload before it", async () => {
    const mock = await withBoardFeature();
    const entry = mock.flow.enter[0];

    await entry?.callback(boardNode, { mode: "live", signal: new AbortController().signal });

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.log.warn).not.toHaveBeenCalledWith(
      "assets: the node waited for a bundle",
      expect.anything()
    );
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

    expect(mock.ctx.state.scenes.size).toBe(0);
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

describe("releaseAll after a dev hot swap", () => {
  it("forgets the stamp it applied and the swap it ran", async () => {
    const mock = createMockAssets({ manifest });

    await mock.start();
    mock.ctx.state.stamps = { "features/board/assets/cell.png": "100:1" };
    mock.ctx.state.swapping = Promise.resolve();
    releaseAll(mock.ctx.state);

    expect(mock.ctx.state.stamps).toBeUndefined();
    expect(mock.ctx.state.swapping).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The episode game: `home` rests on `home.main/idle` with the scene `lobby`;
// `episodes` shows the scene `ward`, whose `bundles` names the episode of the
// committed session. `ep01` and `ep02` leave with their feature.
// ---------------------------------------------------------------------------

const episodeManifest = leaving(
  manifestOf({
    location: { feature: "episodes", tier: "scene", keys: ["episodes.location"] },
    "episodes.kit": { feature: "episodes", tier: "feature", keys: ["episodes.frame"] },
    ep01: { feature: "ep01", tier: "lazy", keys: ["ep01.room"] },
    ep02: { feature: "ep02", tier: "lazy", keys: ["ep02.room"] },
    homebg: { feature: "home", tier: "scene", keys: ["home.bg"] }
  }),
  "ep01",
  "ep02"
);

const ward = sceneOf("ward", "location", ({ session }) => [
  (session as { episode: string }).episode
]);
const lobby = sceneOf("lobby", "homebg");
const broken = sceneOf("broken", "location", () => {
  throw new Error("no episode yet");
});

/**
 * Builds the info of one node of the episode game.
 *
 * @param flow - Its flow.
 * @param node - Its name.
 * @param scene - Its scene, when it names one.
 * @returns The node info `onEnter` hands over.
 */
function nodeAt(flow: string, node: string, scene?: string): NodeInfo {
  return {
    path: `${flow}/${node}`,
    flow,
    node,
    rest: true,
    over: false,
    checkpoint: false,
    barrier: false,
    ...(scene === undefined ? {} : { scene })
  };
}

const idle = nodeAt("home.main", "idle", "lobby");
const wardNode = nodeAt("episodes.pick", "ward", "ward");

/**
 * Starts the episode game, connected, with the session on episode 1.
 *
 * @param options - Config overrides.
 * @returns The started mock.
 */
async function episodeGame(
  options: Parameters<typeof createMockAssets>[0] = {}
): Promise<MockAssets> {
  const mock = createMockAssets({ manifest: episodeManifest, preloadDepth: 0, ...options });

  mock.flow.features.push(
    { name: "home", description: { scenes: [lobby], flows: [{ id: "home.main" }] } as never },
    {
      name: "episodes",
      description: { scenes: [ward, broken], flows: [{ id: "episodes.pick" }] } as never
    }
  );
  mock.flow.graph = graphOf({
    "home.main": { idle: { owner: "home", scene: "lobby", rest: true } },
    "episodes.pick": { ward: { owner: "episodes", scene: "ward", rest: true } }
  });
  mock.model.session = { episode: "ep01" };
  mock.connect();
  await mock.start();

  return mock;
}

/**
 * Enters a node through the `load` stage, with the stack moved to it as flow does first.
 *
 * @param mock - The mock plugin.
 * @param node - The node.
 * @param mode - The runner's mode.
 */
async function enter(
  mock: MockAssets,
  node: NodeInfo,
  mode: "live" | "fast" = "live"
): Promise<void> {
  mock.flow.stack = [{ flow: node.flow, node: node.node, input: 0 }];
  await mock.flow.enter[0]?.callback(node, { mode, signal: new AbortController().signal });
}

/**
 * Sends `flow:rest`, which fires before the arriving node's stages.
 *
 * @param mock - The mock plugin.
 */
function rest(mock: MockAssets): void {
  createHandlers(mock.ctx)["flow:rest"]({ path: "", checkpoint: false });
}

describe("the release at a rest", () => {
  it("runs in the arriving node's load stage: a bundle nobody holds goes, one the arriving scene names stays", async () => {
    const mock = await episodeGame();

    await mock.api.load("ep01");
    await mock.api.load("ep02");
    // The outgoing scene is the lobby, and the arriving ward names ep01 through bundles(state).
    mock.api.sceneBundles(["homebg"]);
    rest(mock);
    await enter(mock, wardNode);

    // ep01 was never let go: a release before the pin would unload it and the stage reload it.
    expect(mock.api.isLoaded("ep01")).toBe(true);
    expect(mock.api.isLoaded("ep02")).toBe(false);
    expect(mock.emitted.filter(entry => entry.name === "assets:bundle-unloaded")).toEqual([
      {
        name: "assets:bundle-unloaded",
        payload: { bundle: "ep02", tier: "lazy", mb: 0.063, reason: "leave", keys: ["ep02.room"] }
      }
    ]);
  });

  it("keeps a bundle the still mounted scene names, and releases it at the first sync after the scene stopped naming it", async () => {
    const mock = await episodeGame();

    await enter(mock, wardNode);
    mock.api.sceneBundles(["location", "ep01"]);

    // The first rest on the way home: the ward is still mounted.
    rest(mock);
    await enter(mock, idle);

    expect(mock.api.isLoaded("ep01")).toBe(true);

    // The lobby is mounted now: the ward's bundle is a leaving scene's, held at the rest (F51b), and the first sync
    // that finds nothing leaving lets it go.
    mock.api.sceneBundles(["homebg"]);
    rest(mock);
    await enter(mock, idle);

    expect(mock.api.isLoaded("ep01")).toBe(true);

    mock.world.sync();

    expect(mock.api.isLoaded("ep01")).toBe(false);
  });

  it("runs once per rest: a second entry without a rest releases nothing", async () => {
    const mock = await episodeGame();

    await mock.api.load("ep02");
    rest(mock);
    await enter(mock, idle);
    await mock.api.load("ep02");
    await enter(mock, idle);

    expect(mock.api.isLoaded("ep02")).toBe(true);
  });

  it("releases nothing on a fast entry, and the rest it followed is used up", async () => {
    const mock = await episodeGame();

    await mock.api.load("ep02");
    rest(mock);
    await enter(mock, idle, "fast");

    expect(mock.api.isLoaded("ep02")).toBe(true);
    expect(mock.ctx.state.restPending).toBe(false);
  });
});

describe("the scene names of the node being entered", () => {
  it("pins what the scene names of the committed state, then the feature bundles, and carries them to a node without a scene", async () => {
    const mock = await episodeGame();

    mock.model.session = { episode: "ep02" };
    await enter(mock, wardNode, "fast");

    expect([...mock.ctx.state.pinned]).toEqual(["location", "ep02", "episodes.kit"]);

    await enter(mock, nodeAt("episodes.pick", "think"), "fast");

    expect([...mock.ctx.state.pinned]).toEqual(["location", "ep02", "episodes.kit"]);
  });

  it("fails the load stage when the scene's bundles throws", async () => {
    const mock = await episodeGame();

    await expect(enter(mock, nodeAt("episodes.pick", "oops", "broken"))).rejects.toThrow(
      "no episode yet"
    );
  });

  it('warns that the node waited for a "budget" bundle, never for a "leave" one', async () => {
    const mock = await episodeGame();

    mock.ctx.state.restedLive = true;
    await enter(mock, wardNode);

    expect(mock.log.warn).toHaveBeenCalledWith("assets: the node waited for a bundle", {
      bundle: "location",
      path: "episodes.pick/ward"
    });
    expect(mock.log.warn).not.toHaveBeenCalledWith(
      "assets: the node waited for a bundle",
      expect.objectContaining({ bundle: "ep01" })
    );
    expect(mock.api.isLoaded("ep01")).toBe(true);
  });
});

describe("the companions at entry and at stop", () => {
  it("calls no companion while headless", async () => {
    const mock = await episodeGame({ io: undefined });
    const companion = { load: vi.fn(async () => undefined), unload: vi.fn() };

    mock.api.companions.add(companion);
    await enter(mock, wardNode);
    await mock.api.load("ep01");

    expect(companion.load).not.toHaveBeenCalled();
    expect(companion.unload).not.toHaveBeenCalled();
  });

  it("forgets the companions in releaseAll without calling their unload", async () => {
    const mock = await episodeGame();
    const companion = { load: vi.fn(async () => undefined), unload: vi.fn() };

    mock.api.companions.add(companion);
    await mock.api.load("ep01");
    releaseAll(mock.ctx.state);

    expect(mock.ctx.state.companions).toEqual([]);
    expect(companion.unload).not.toHaveBeenCalled();
  });
});
