import { afterEach, describe, expect, it, vi } from "vitest";
import { defineScene } from "../../define";
import { leaveOf } from "../../leave";
import { checkConfig } from "../../lifecycle";
import type { Config, SceneLeave } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of what a live switch shows over the scene being left (spec 33, slice A2): the merge of the scene's
// `leave` over the config's over the engine's, the look handed to the renderer at the switch start (before the
// bundles are in), its land after the swap and its drop on an abort, a throw or a stop, the loader projection mounted
// for the wait, and the checks of a `leave` a game wrote. The renderer's `sync.leave` is three spies that record the
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
 * Lets the held loads go, steps the build's frame with the build done, and waits for the switch.
 *
 * @param mock - The mock with a switch at its bundle wait.
 * @param entering - The switch.
 */
async function finish(mock: MockScenes, entering: Promise<void>): Promise<void> {
  mock.assets.release();
  await flush();
  mock.world.building.done = true;
  mock.time.frame();
  await entering;
}

describe("the merge of `leave`", () => {
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
  // walk), a headless app, or a scene that leaves with `false`.
  it.each([
    ["the first scene of a run", { first: undefined, mode: "live", ready: true }],
    ["a fast walk", { first: "home", mode: "fast", ready: true }],
    ["a headless app", { first: "home", mode: "live", ready: false }],
    ["a scene that leaves with `false`", { first: "ward", mode: "live", ready: true }]
  ] as const)("shows nothing for %s", async (_case, setup) => {
    const mock = createMockScenes();

    mock.flow.features.push({
      name: "screens",
      description: { scenes: [homeScene, boardScene, wardScene] }
    });
    mock.start();
    if (setup.first !== undefined) await mock.enter({ rest: true, scene: setup.first });
    mock.renderer.host.ready.mockReturnValue(setup.ready);
    // A build aside commits at its start: nothing is left for ui and the renderer.
    mock.world.building.done = true;
    await mock.enter({ rest: true, scene: "board" }, { mode: setup.mode });

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

describe("a loader projection", () => {
  // Bug: the loader projection is not mounted for the wait, its layer is not handed to the renderer, or it stays
  // mounted over the next scene.
  it("is mounted at the switch start, drawn by its layer, and unmounted after the land", async () => {
    const mock = await on("home", {
      buildMs: "auto",
      leave: { loader: { projection: "loading" } }
    });

    mock.world.viewLayers = { loading: "loading" };
    const { entering } = await enterScene(mock, "board");

    expect(mock.world.mounted.at(-1)).toEqual({
      names: ["loading"],
      owner: { kind: "plugin", name: "scenes" }
    });
    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400, layer: "loading" }
    });

    mock.renderer.sync.leave.land.mockImplementation(() => {
      expect(mock.world.unmounted).not.toContainEqual(["loading"]);
    });
    await finish(mock, entering);

    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });

  // Bug: an abort leaves the loader projection mounted.
  it("is unmounted at the abort", async () => {
    const mock = await on("home", {
      buildMs: "auto",
      leave: { loader: { projection: "loading" } }
    });
    const controller = new AbortController();

    mock.world.viewLayers = { loading: "loading" };
    await enterScene(mock, "board", controller.signal);
    controller.abort();

    expect(mock.world.unmounted).toEqual([["loading"]]);
  });

  // Bug: a loader projection with no item hands the renderer no layer to draw (a blank wait), or stays mounted.
  it("draws the engine's ring when it has no view, and is still unmounted at the end", async () => {
    const mock = await on("home", {
      buildMs: "auto",
      leave: { loader: { projection: "loading" } }
    });
    const { entering } = await enterScene(mock, "board");

    expect(mock.world.mounted.at(-1)?.names).toEqual(["loading"]);
    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400 }
    });

    await finish(mock, entering);

    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });

  // Bug: a loader the scene cannot mount rejects the switch, or a projection a scene lists is mounted twice and
  // unmounted under the scene that needs it.
  it.each([
    ["one the scene cannot mount", "loading", "scenes:loader-unmounted"],
    ["one the scene being left lists", "home.menu", "scenes:loader-listed"],
    ["one the coming scene lists", "board.cells", "scenes:loader-listed"]
  ] as const)("draws the engine's ring instead of %s, warned", async (_case, name, warning) => {
    const mock = await on("home", { buildMs: "auto", leave: { loader: { projection: name } } });

    mock.world.mountError = new Error('[game] Projection "loading" names layer "loading".');
    mock.world.viewLayers = { [name]: "ui" };
    mock.world.calls.length = 0;
    const { entering } = await enterScene(mock, "board");

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400 }
    });
    expect(mock.log.warn).toHaveBeenCalledWith(
      warning,
      expect.objectContaining({ projection: name })
    );

    mock.world.mountError = undefined;
    await finish(mock, entering);

    // The swap's unmount of what only home lists, and no second one of the loader.
    expect(mock.world.calls.filter(call => call === "unmount")).toHaveLength(1);
  });
});

describe("the checks of `leave`", () => {
  // Bug: a wrong value reaches the renderer and draws a veil that never fades, or never shows.
  it.each([
    ["a string", "dim", "scenes.leave is dim."],
    ["a part that is no object", { loader: 400 }, "scenes.leave.loader is 400."],
    ["an alpha over 1", { cover: { alpha: 2 } }, "scenes.leave.cover.alpha is 2."],
    [
      "a colour that is no whole number",
      { cover: { color: 0.5 } },
      "scenes.leave.cover.color is 0.5."
    ],
    ["a negative duration", { cover: { inMs: -1 } }, "scenes.leave.cover.inMs is -1."],
    [
      "a delay that is no number",
      { loader: { afterMs: "soon" } },
      "scenes.leave.loader.afterMs is soon."
    ],
    ["an empty texture key", { loader: { texture: "" } }, "scenes.leave.loader.texture is ."]
  ])("refuses %s in the config at createApp", (_case, leave, message) => {
    expect(() => checkConfig({ buildMs: "auto", leave: leave as SceneLeave })).toThrow(
      `[game] ${message}\n  Give `
    );
  });

  // Bug: a scene's wrong `leave` throws only at its first switch, far from the line that wrote it.
  it("refuses a scene's `leave` of the wrong shape at `defineScene`, naming the scene", () => {
    expect(() =>
      defineScene("board", {
        bundle: "board",
        layers: {},
        projections: [],
        leave: { cover: { outMs: Number.NaN } }
      })
    ).toThrow(
      '[game] Scene "board": leave.cover.outMs is NaN.\n  Give the milliseconds of the fade-out, 0 or more.'
    );
  });
});
