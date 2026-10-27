import { afterEach, describe, expect, it, vi } from "vitest";
import { stages } from "../../../flow/runner/loop-types";
import type { NodeInfo } from "../../../flow/types";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";
import { FALLBACK_LEAVE, leaveOf } from "../../leave";
import type { Config, RunContext } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of what a live switch shows over the scene being left (spec 33, slice A2): the merge of the scene's
// `leave` over the config's over the engine's, the look handed to the renderer at the switch start (before the
// bundles are in), its land after the swap and its drop on an abort, a throw or a stop, the loader projection mounted
// for the wait. The renderer's `sync.leave` is three spies that record the
// scene current at each call.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The engine's veil, what a game that writes nothing gets. */
const VEIL = { color: 0x00_00_00, alpha: 0.45, inMs: 150, outMs: 150 };

const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {}, loading: {} },
  projections: [{ name: "home.menu", layer: "ui" }]
});

const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [{ name: "board.cells", layer: "cells" }],
  leave: { cover: { color: 0x0b_10_20, alpha: 0.6 }, loader: { texture: "ui.loader.ring" } }
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [],
  leave: false
});

/**
 * Gives the pending promise callbacks of the switch their turns: the loads and the warm.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Starts the plugin with home, board and ward, mounts the first scene in one block, and lets the renderer draw from
 * now on. Every load is held from now on until the test releases it.
 *
 * @param first - The scene mounted first.
 * @param config - The config of the plugin.
 * @returns The started mock.
 */
async function on(first: string, config?: Config): Promise<MockScenes> {
  const mock = createMockScenes(config);

  mock.flow.features.push({
    name: "screens",
    description: { scenes: [homeScene, boardScene, wardScene] }
  });
  mock.start();
  await mock.enter({ rest: true, scene: first });
  mock.renderer.host.ready.mockReturnValue(true);
  mock.assets.control.gated = true;

  return mock;
}

/**
 * Starts a switch and lets it reach the bundle wait.
 *
 * @param mock - The started mock.
 * @param scene - The scene to switch to.
 * @param signal - The abort signal of the node.
 * @returns The switch, settled or rejected later.
 */
async function enterScene(
  mock: MockScenes,
  scene: string,
  signal?: AbortSignal
): Promise<{ entering: Promise<void> }> {
  const entering = mock.enter({ rest: true, scene }, signal === undefined ? {} : { signal });

  // A rejection is read by the test that waits for it; none is left unhandled.
  entering.catch(() => undefined);
  await flush();

  return { entering };
}

/**
 * Switches to the board as a live node does: the stages, the reaction frame drawn, and the switch waited for.
 *
 * @param mock - The mock on home.
 * @param run - The mode of the run.
 * @returns The switch, settled.
 */
async function switchTo(mock: MockScenes, run: Partial<RunContext> = {}): Promise<void> {
  const entering = mock.enter({ rest: true, scene: "board" }, run);

  entering.catch(() => undefined);
  await flush();
  // The reaction frame, then the frame the build starts in.
  mock.time.frame();
  mock.time.frame();

  return entering;
}

/**
 * Lets the held loads go, steps the build's frame with the build done, and waits for the switch.
 *
 * @param mock - The mock with a switch at its bundle wait.
 * @param entering - The switch.
 */
async function finish(mock: MockScenes, entering: Promise<void>): Promise<void> {
  mock.assets.release();
  await flush();
  // The reaction frame, then the build starts in the next frame's `signals` phase (slice R).
  mock.time.phase("render");
  mock.time.phase("signals");
  await flush();
  mock.world.building.done = true;
  mock.time.frame();
  await entering;
}

describe("the merge of `leave`", () => {
  // Bug: the default config a game gets and the fallback of a part written over `false` drift apart, so a game that
  // turns the veil off in its config and back on in a scene gets another veil than one that writes nothing.
  it("has the plugin's default config and its fallback equal", () => {
    expect(scenesPlugin.spec.config?.leave).toEqual(FALLBACK_LEAVE);
  });

  // Bug: a level replaces the whole part below it (shallow), so a scene that writes a colour loses the config's alpha.
  it("takes each field from the highest level that writes it: the scene's, the config's, the engine's", () => {
    expect(
      leaveOf({ cover: { alpha: 0.3 }, loader: { afterMs: 250 } }, { cover: { color: 0x0b_10_20 } })
    ).toEqual({
      cover: { color: 0x0b_10_20, alpha: 0.3, inMs: 150, outMs: 150 },
      loader: { afterMs: 250 }
    });
  });

  // Bug: `false` on one part turns the whole look off, or is ignored.
  it("turns a part off with `false` and keeps the other", () => {
    expect(leaveOf(undefined, { loader: false })).toEqual({ cover: VEIL, loader: false });
    expect(leaveOf({ cover: false }, undefined)).toEqual({
      cover: false,
      loader: { afterMs: 400 }
    });
  });

  // Bug: a scene that turns its look back on over a config `false` gets nothing, or `false` on both parts still
  // shows an empty look.
  it("shows nothing for `false` as the whole, and starts a part written over it from the engine's", () => {
    expect(leaveOf(undefined, false)).toBeUndefined();
    expect(leaveOf(false, undefined)).toBeUndefined();
    expect(leaveOf({ cover: false, loader: false }, undefined)).toBeUndefined();
    expect(leaveOf(false, { cover: { alpha: 0.6 } })).toEqual({
      cover: { ...VEIL, alpha: 0.6 },
      loader: false
    });
    expect(leaveOf({ loader: false }, { loader: { texture: "ui.loader.ring" } })).toEqual({
      cover: VEIL,
      loader: { afterMs: 400, texture: "ui.loader.ring" }
    });
  });

  // Bug: a scene that names a texture keeps the config's projection too, and draws the wrong loader.
  it("takes `texture` and `projection` as one choice, `projection` first when one level names both", () => {
    expect(
      leaveOf({ loader: { projection: "loading" } }, { loader: { texture: "ui.loader.ring" } })
    ).toEqual({ cover: VEIL, loader: { afterMs: 400, texture: "ui.loader.ring" } });
    expect(
      leaveOf(undefined, { loader: { texture: "ui.loader.ring", projection: "loading" } })
    ).toEqual({ cover: VEIL, loader: { afterMs: 400, projection: "loading" } });
    expect(
      leaveOf({ loader: { texture: "ui.loader.ring" } }, { loader: { afterMs: 100 } })
    ).toEqual({
      cover: VEIL,
      loader: { afterMs: 100, texture: "ui.loader.ring" }
    });
  });
});

describe("a live switch", () => {
  // Bug: the look waits for the bundles (a cold first visit shows nothing for seconds), or the coming scene decides.
  it("shows the look of the scene being left at its start, before its bundles are in", async () => {
    const mock = await on("board");

    await enterScene(mock, "home");

    expect(mock.assets.held.map(load => load.bundle)).toEqual(["home"]);
    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: { color: 0x0b_10_20, alpha: 0.6, inMs: 150, outMs: 150 },
      loader: { afterMs: 400, texture: "ui.loader.ring" }
    });
  });

  // Bug: the look lands before the next scene stands (the veil fades out over the old one), lands twice, or drops.
  it("lands once, after the swap", async () => {
    const mock = await on("home");
    const { entering } = await enterScene(mock, "board");

    await finish(mock, entering);

    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "land", current: "board" }
    ]);
  });

  // Bug: a switch shows a veil where nobody sees a switch: the first scene of a run, a fast walk (a restore, a test
  // walk), a node entered live while the world walks fast or stands paused (a repro restore), a headless app, or a
  // scene that leaves with `false`.
  it.each([
    ["the first scene of a run", { first: undefined, mode: "live", world: "live", ready: true }],
    ["a fast walk", { first: "home", mode: "fast", world: "live", ready: true }],
    ["a live run over a fast world", { first: "home", mode: "live", world: "fast", ready: true }],
    [
      "a live run over a paused world",
      { first: "home", mode: "live", world: "paused", ready: true }
    ],
    ["a headless app", { first: "home", mode: "live", world: "live", ready: false }],
    [
      "a scene that leaves with `false`",
      { first: "ward", mode: "live", world: "live", ready: true }
    ]
  ] as const)("shows nothing for %s", async (_case, setup) => {
    const mock = createMockScenes();

    mock.flow.features.push({
      name: "screens",
      description: { scenes: [homeScene, boardScene, wardScene] }
    });
    mock.start();
    if (setup.first !== undefined) await mock.enter({ rest: true, scene: setup.first });
    mock.renderer.host.ready.mockReturnValue(setup.ready);
    mock.world.mode = setup.world;
    // A build aside commits at its start: nothing is left for ui and the renderer.
    mock.world.building.done = true;
    await switchTo(mock, { mode: setup.mode });

    expect(mock.renderer.leaves).toEqual([]);
  });

  // Bug: a part a game turned off is still handed to the renderer, which draws it.
  it.each([
    ["loader", { loader: false }, { cover: VEIL }],
    ["veil", { cover: false }, { loader: { afterMs: 400 } }]
  ] as const)("hands the renderer no %s when it is off", async (_case, leave, look) => {
    const mock = await on("home", { buildMs: "auto", leave });

    await enterScene(mock, "board");

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith(look);
  });

  // Bug: an abort (a restore, the inbox) leaves the veil up until the cancelled loads settle, or lands it.
  it("drops the look at the abort, before the loads settle, and only once", async () => {
    const mock = await on("home");
    const controller = new AbortController();
    const { entering } = await enterScene(mock, "board", controller.signal);

    controller.abort();

    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "drop", current: "home" }
    ]);

    mock.assets.release();
    await entering;

    expect(mock.renderer.leaves).toHaveLength(2);
  });

  // Bug: a switch that throws (a failed load) leaves the veil over the old scene for good.
  it("drops the look when the switch throws", async () => {
    const mock = await on("home");
    const { entering } = await enterScene(mock, "board");

    mock.assets.fail(new Error("offline"));

    await expect(entering).rejects.toThrow("offline");
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "drop"]);
  });

  // Bug: a stop during the wait calls the stopped renderer later, from the abort listener or the switch's return.
  it("leaves the renderer alone after a stop", async () => {
    const mock = await on("home");
    const controller = new AbortController();
    const { entering } = await enterScene(mock, "board", controller.signal);

    mock.stop();
    controller.abort();
    mock.assets.release();
    await entering;

    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show"]);
  });
});

/**
 * The `due` of the loader the renderer was handed: what the renderer calls the first frame the loader is due.
 *
 * @param mock - The mock with a switch at its start.
 * @returns The callback.
 */
function dueOf(mock: MockScenes): () => string | undefined {
  const due = mock.renderer.sync.leave.show.mock.calls.at(-1)?.[0].loader?.due;

  if (due === undefined) throw new Error("the look has no due loader");

  return due;
}

/** A config whose loader is the projection "loading". */
const LOADING: Config = { buildMs: "auto", leave: { loader: { projection: "loading" } } };

describe("a loader projection", () => {
  // Bug: the loader projection is mounted at the tap (its `from` and `view` run in the frame of the first answer), its
  // layer is not handed to the renderer, or it stays mounted over the next scene.
  it("is mounted once its loader is due, drawn by its layer, and unmounted after the land", async () => {
    const mock = await on("home", LOADING);

    mock.world.viewLayers = { loading: "loading" };
    const { entering } = await enterScene(mock, "board");

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400, due: expect.any(Function) }
    });
    expect(mock.world.mounted.map(entry => entry.names)).not.toContainEqual(["loading"]);

    expect(dueOf(mock)()).toBe("loading");
    expect(mock.world.mounted.at(-1)).toEqual({
      names: ["loading"],
      owner: { kind: "plugin", name: "scenes" }
    });

    mock.renderer.sync.leave.land.mockImplementation(() => {
      expect(mock.world.unmounted).not.toContainEqual(["loading"]);
    });
    await finish(mock, entering);

    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });

  // Bug: a warm switch, done before `afterMs`, mounts and unmounts the loader projection all the same.
  it("is never mounted by a switch done before its loader is due", async () => {
    const mock = await on("home", LOADING);

    mock.world.viewLayers = { loading: "loading" };
    const { entering } = await enterScene(mock, "board");

    await finish(mock, entering);

    expect(mock.world.mounted.flatMap(entry => entry.names)).not.toContain("loading");
    expect(mock.world.unmounted.flat()).not.toContain("loading");
  });

  // Bug: an abort, or a switch that throws once the loader was mounted, leaves the loader projection mounted.
  it.each([
    ["an abort", "abort"],
    ["a throw", "throw"]
  ] as const)("is unmounted at %s after it was mounted", async (_case, how) => {
    const mock = await on("home", LOADING);
    const controller = new AbortController();

    mock.world.viewLayers = { loading: "loading" };
    const { entering } = await enterScene(mock, "board", controller.signal);

    dueOf(mock)();
    if (how === "abort") controller.abort();
    else mock.assets.fail(new Error("offline"));
    await entering.catch(() => undefined);

    expect(mock.world.unmounted).toEqual([["loading"]]);
  });

  // Bug: a stop calls the stopped world from the switch's end to unmount the loader projection it mounted.
  it("is left to the world's stop when the plugin stops after it was mounted", async () => {
    const mock = await on("home", LOADING);
    const controller = new AbortController();

    mock.world.viewLayers = { loading: "loading" };
    const { entering } = await enterScene(mock, "board", controller.signal);

    dueOf(mock)();
    mock.stop();
    controller.abort();
    mock.assets.release();
    await entering;

    expect(mock.world.mounted.at(-1)?.names).toEqual(["loading"]);
    expect(mock.world.unmounted.flat()).not.toContain("loading");
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show"]);
  });

  // Bug: a projection someone else mounted is unmounted by the switch, or mounted a second time.
  it("is drawn but neither mounted nor unmounted when it is mounted already", async () => {
    const mock = await on("home", LOADING);

    mock.world.viewLayers = { loading: "loading" };
    mock.world.live.add("loading");
    const { entering } = await enterScene(mock, "board");

    expect(dueOf(mock)()).toBe("loading");

    await finish(mock, entering);

    expect(mock.world.mounted.flatMap(entry => entry.names)).not.toContain("loading");
    expect(mock.world.unmounted.flat()).not.toContain("loading");
  });

  // Bug: a loader drawn in a layer the scene being left draws in too lifts that scene's views above the veil.
  it("gives the ring when a projection of the scene being left draws in its layer, warned and unmounted", async () => {
    const mock = await on("home", LOADING);

    mock.world.viewLayers = { "home.menu": "ui", loading: "ui" };
    await enterScene(mock, "board");

    expect(dueOf(mock)()).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledWith("scenes:loader-layer-shared", {
      projection: "loading",
      layer: "ui",
      scene: "home"
    });
    expect(mock.world.unmounted).toEqual([["loading"]]);
  });

  // Bug: a loader projection with no item hands the renderer no layer to draw (a blank wait), or stays mounted.
  it("gives the ring when it has no view, and is still unmounted at the end", async () => {
    const mock = await on("home", LOADING);
    const { entering } = await enterScene(mock, "board");

    expect(dueOf(mock)()).toBeUndefined();
    expect(mock.world.mounted.at(-1)?.names).toEqual(["loading"]);

    await finish(mock, entering);

    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });

  // Bug: a loader the scene cannot mount rejects the switch, warns nothing, or is unmounted though never mounted.
  it("gives the ring when the scene being left cannot mount it, warned", async () => {
    const mock = await on("home", LOADING);

    mock.world.mountError = new Error('[game] Projection "loading" names layer "loading".');
    const { entering } = await enterScene(mock, "board");

    expect(dueOf(mock)()).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "scenes:loader-unmounted",
      expect.objectContaining({ projection: "loading", scene: "home" })
    );

    await finish(mock, entering);

    expect(mock.world.unmounted.flat()).not.toContain("loading");
  });

  // Bug: a projection a scene lists is mounted twice and unmounted under the scene that needs it.
  it.each([
    ["the scene being left", "home.menu"],
    ["the coming scene", "board.cells"]
  ] as const)("is no loader when %s lists it: the ring, warned", async (_case, name) => {
    const mock = await on("home", { buildMs: "auto", leave: { loader: { projection: name } } });

    mock.world.calls.length = 0;
    const { entering } = await enterScene(mock, "board");

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400 }
    });
    expect(mock.log.warn).toHaveBeenCalledWith(
      "scenes:loader-listed",
      expect.objectContaining({ projection: name })
    );

    await finish(mock, entering);

    // The swap's unmount of what only home lists, and no other.
    expect(mock.world.calls.filter(call => call === "unmount")).toHaveLength(1);
  });
});

/**
 * Enters a node through every stage of flow, in flow's order, each awaited, the way the runner does.
 *
 * @param mock - The started mock.
 * @param node - The node being entered.
 * @param run - The mode and the signal of the node.
 */
async function enterStages(
  mock: MockScenes,
  node: Partial<NodeInfo>,
  run: Partial<RunContext>
): Promise<void> {
  for (const stage of stages) await mock.stage(stage, node, run);
}

describe("the begin stage of a node that switches", () => {
  // Bug: the look waits for the `load` stage (a cold first visit shows nothing until the coming scene's bundles are
  // downloaded), or the `scene` stage starts a second look over the first.
  it("shows the look before the load stage downloads the coming scene, and the scene stage takes it over", async () => {
    const mock = await on("home");
    const download = Promise.withResolvers<void>();
    const run = { signal: new AbortController().signal };

    // The `load` stage of assets: the board is still downloading.
    mock.flow.api.onEnter("load", () => download.promise);
    const entering = enterStages(mock, { rest: true, scene: "board" }, run);

    await flush();

    expect(mock.renderer.leaves).toEqual([{ call: "show", current: "home" }]);
    expect(mock.assets.loaded).not.toContain("board");

    download.resolve();
    await flush();
    await finish(mock, entering);

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledOnce();
    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "land", current: "board" }
    ]);
  });

  // Bug: a node that keeps the scene dims it (every popup and every rest of the same scene flashes a veil), a fast
  // walk shows one, or an over node takes its own scene, which the scene stage ignores.
  it.each([
    ["a node of the mounted scene", { rest: true, scene: "home" }, "live"],
    ["a node without a scene and nothing expected", { rest: true }, "live"],
    ["an over node with nothing expected", { rest: true, over: true }, "live"],
    [
      "an over node that names a scene of its own",
      { rest: true, over: true, scene: "board" },
      "live"
    ],
    ["a transit node of a fast walk", { scene: "board" }, "fast"]
  ] as const)("starts nothing for %s", async (_case, node, mode) => {
    const mock = await on("home");

    await mock.stage("begin", node, { mode });

    expect(mock.renderer.leaves).toEqual([]);
    expect(mock.state.leaving).toBeUndefined();
  });

  // Bug: the begin stage reads only the node's own scene, so a restore at a popup over another scene shows no veil.
  it("shows the look for an over node that takes the expected scene", async () => {
    const mock = await on("home");

    mock.api.expect("board");
    await mock.stage("begin", { rest: true, over: true });

    expect(mock.renderer.leaves).toEqual([{ call: "show", current: "home" }]);
  });

  // Bug: the begin stage reads only the node's own scene, so a node without one that mounts the expected scene (the
  // restore door's `expect`) shows no veil while its bundles download.
  it("shows the look for a node without a scene of its own that takes the expected scene", async () => {
    const mock = await on("home");

    mock.api.expect("board");
    await mock.stage("begin", { rest: true });

    expect(mock.renderer.leaves).toEqual([{ call: "show", current: "home" }]);
  });

  // Bug: the begin stage shows a veil for a scene no feature declared, which the scene stage refuses with a throw.
  it("starts nothing for a scene no feature declared", async () => {
    const mock = await on("home");

    await mock.stage("begin", { rest: true, scene: "nowhere" });

    expect(mock.renderer.leaves).toEqual([]);
    expect(mock.state.leaving).toBeUndefined();
  });

  // Bug: a `load` stage that throws (a download that failed) leaves the veil and the ring over the old scene for good:
  // the throw aborts nothing and the node never reaches its `scene` stage, so neither the listener nor the switch
  // drops it.
  it("drops a look whose load stage threw when flow enters the rest node it rolled back to", async () => {
    const mock = await on("home");

    await mock.stage("begin", { rest: true, scene: "board" });
    // The `load` stage threw: flow rolls back and enters the rest node of home again.
    await mock.enter({ rest: true, scene: "home" });

    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "drop", current: "home" }
    ]);
    expect(mock.state.leaving).toBeUndefined();
    expect(mock.state.current).toBe("home");
  });

  // Bug: the look of the next switch is shown first and the left-over one is then forgotten undropped (its loader
  // projection stays mounted, its abort listener stays), or the drop takes the new look down.
  it("drops a left-over look before it shows the look of the next switch", async () => {
    const mock = await on("home", LOADING);

    mock.world.viewLayers = { loading: "loading" };
    await mock.stage("begin", { rest: true, scene: "board" });
    dueOf(mock)();
    await mock.stage("begin", { rest: true, scene: "ward" });

    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "drop", "show"]);
    expect(mock.world.unmounted).toEqual([["loading"]]);
    expect(mock.state.leaving).toBeDefined();
  });

  // Bug: the begin stage saw a switch the scene stage does not make (the expected scene changed in between), and the
  // veil stays over the scene the node rests on.
  it("drops the look when the scene stage of its node does not switch after all", async () => {
    const mock = await on("home");
    const run = { signal: new AbortController().signal };

    mock.api.expect("board");
    await mock.stage("begin", { rest: true, over: true }, run);
    mock.api.expect("home");
    await mock.stage("scene", { rest: true, over: true }, run);

    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "drop", current: "home" }
    ]);
    expect(mock.state.current).toBe("home");
  });

  // Bug: the expected scene changed between the stages to a third scene, and the switch takes over the look `begin`
  // resolved for the first one: its loader was checked against the wrong scene (here: the ring, though the scene the
  // switch mounts does not list the loader projection).
  it("shows the look again when the scene stage switches to another scene than begin saw", async () => {
    const mock = await on("home", {
      buildMs: "auto",
      leave: { loader: { projection: "board.cells" } }
    });
    const run = { signal: new AbortController().signal };

    mock.api.expect("board");
    await mock.stage("begin", { rest: true, over: true }, run);
    mock.api.expect("ward");
    const entering = mock.stage("scene", { rest: true, over: true }, run);

    entering.catch(() => undefined);
    await flush();
    await finish(mock, entering);

    expect(mock.renderer.leaves).toEqual([
      { call: "show", current: "home" },
      { call: "drop", current: "home" },
      { call: "show", current: "home" },
      { call: "land", current: "ward" }
    ]);
    expect(mock.renderer.sync.leave.show.mock.calls.map(([look]) => look.loader)).toEqual([
      { afterMs: 400 },
      { afterMs: 400, due: expect.any(Function) }
    ]);
  });

  // Bug: a `bundles` that throws at the scene stage leaves the look its begin stage showed.
  it("drops the look when the scene's bundles throw at the scene stage", async () => {
    const mock = createMockScenes();
    const broken = defineScene("broken", {
      bundle: "broken",
      bundles: () => {
        throw new Error("no episode");
      },
      layers: { room: {} },
      projections: []
    });

    mock.flow.features.push({ name: "screens", description: { scenes: [homeScene, broken] } });
    mock.start();
    await mock.enter({ rest: true, scene: "home" });
    mock.renderer.host.ready.mockReturnValue(true);

    await expect(mock.enter({ rest: true, scene: "broken" })).rejects.toThrow("no episode");
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "drop"]);
  });
});
