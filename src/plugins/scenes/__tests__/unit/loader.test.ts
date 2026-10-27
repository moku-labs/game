import { describe, expect, it } from "vitest";
import { defineScene } from "../../define";
import type { Config } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of the loader projection of a switch (F103, F107 part 3): a scene that stands holds the projection its
// leave loader names, built and hidden by `world`; the renderer's `due` shows it and answers the layer of its spec; a
// loader the scene does not hold is mounted at the due (A2). After the swap the loader fades out with the veil and goes
// in the frame the veil's `outMs` ran out, or is held again for the next switch; a drop takes it down at once. The fake
// world records `hold`, `show`, `mount` and `unmount`; a shown projection has no view until the test gives it one.
// ---------------------------------------------------------------------------

/** The ward: declares the loader's layer, so it holds the loader. */
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {}, loading: {} },
  projections: [{ name: "ward.room", layer: "room" }]
});

/** The home: declares the loader's layer too, and draws its menu in `ui`. */
const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {}, loading: {} },
  projections: [{ name: "home.menu", layer: "ui" }]
});

/** The board: does not declare the loader's layer, so it holds none. */
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [{ name: "board.cells", layer: "cells" }]
});

/** A scene that leaves with nothing at all. */
const quietScene = defineScene("quiet", {
  bundle: "quiet",
  layers: { loading: {} },
  projections: [],
  leave: false
});

/** A scene that leaves with another loader projection, in the same layer. */
const spinScene = defineScene("spin", {
  bundle: "spin",
  layers: { loading: {} },
  projections: [],
  leave: { loader: { projection: "spinner" } }
});

/** A scene that lists the loader projection as its own. */
const lobbyScene = defineScene("lobby", {
  bundle: "lobby",
  layers: { loading: {} },
  projections: [{ name: "loading", layer: "loading" }]
});

/** The projections the features bring: what `world` registers, and where scenes reads a loader's layer. */
const PROJECTIONS = [
  { name: "loading", layer: "loading" },
  { name: "spinner", layer: "loading" },
  { name: "overlay", layer: "ui" }
];

/** A config whose loader is the projection "loading". */
const LOADING: Config = { buildMs: "auto", leave: { loader: { projection: "loading" } } };

/** Frames of 16 ms until the engine's 150 ms fade-out ran out. */
const FADE_FRAMES = Math.ceil(150 / 16);

/**
 * Gives the pending promise callbacks of the switch their turns: the loads and the warm.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Starts the plugin and stands a first scene with a drawing renderer, a live world and a build that commits at once.
 * Every load is held from now on until the test releases it.
 *
 * @param first - The scene that stands first.
 * @param config - The config of the plugin.
 * @param ready - Whether the renderer draws when the first scene stands.
 * @returns The started mock.
 */
async function standing(
  first: string,
  config: Config = LOADING,
  ready = true
): Promise<MockScenes> {
  const mock = createMockScenes(config);

  mock.flow.features.push({
    name: "screens",
    description: {
      scenes: [wardScene, homeScene, boardScene, quietScene, spinScene, lobbyScene],
      projections: PROJECTIONS
    }
  });
  mock.start();
  mock.renderer.host.ready.mockReturnValue(ready);
  mock.world.building.done = true;
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
 * @returns The switch, settled or rejected later, in a wrapper: an async function would wait for it.
 */
async function switchTo(
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
 * Lets the held loads go and waits for the switch: the build commits at once, the look lands.
 *
 * @param mock - The mock with a switch at its bundle wait.
 * @param entering - The switch.
 */
async function land(mock: MockScenes, entering: Promise<void>): Promise<void> {
  mock.assets.release();
  await entering;
}

/**
 * The `due` of the loader the renderer was handed last: what the renderer calls the first frame the loader is due.
 *
 * @param mock - The mock with a switch at its start.
 * @returns What the due answers: the layer drawn above the veil, or `undefined` for the ring.
 */
function due(mock: MockScenes): string | undefined {
  const call = mock.renderer.sync.leave.show.mock.calls.at(-1)?.[0].loader?.due;

  if (call === undefined) throw new Error("the look has no due loader");

  return call();
}

/**
 * Steps frames of 16 ms, each with the fields a test gives.
 *
 * @param mock - The mock.
 * @param count - How many frames.
 * @param time - The fields of `Time` to step with.
 * @param time.delta - The frame's delta, after the time scale.
 * @param time.scale - The time scale.
 */
function frames(
  mock: MockScenes,
  count: number,
  time: { delta?: number; scale?: number } = {}
): void {
  for (let frame = 0; frame < count; frame += 1) mock.time.frame(time);
}

describe("a scene that stands", () => {
  // Bug: the loader is not built ahead while the scene stands, so its due mounts it in the switch frame (33–49 ms on
  // the A26), or it is mounted (shown) over the scene.
  it("holds the projection its leave loader names, without mounting it", async () => {
    const mock = await standing("ward");

    expect(mock.world.holds).toEqual([["loading"]]);
    expect(mock.world.calls.at(-1)).toBe("hold");
    expect(mock.world.mounted.flatMap(entry => entry.names)).not.toContain("loading");
    expect(mock.state.held).toEqual({ name: "loading", layer: "loading" });
  });

  // Bug: a scene that stands in a fast walk (a restore), over a world that walks fast, or with no drawing renderer holds
  // a loader no switch of it will show.
  it.each([
    ["a fast walk", "fast", "live", true],
    ["a world that walks fast", "live", "fast", true],
    ["a headless app", "live", "live", false]
  ] as const)("holds nothing when it stands in %s", async (_case, mode, world, ready) => {
    const mock = createMockScenes(LOADING);

    mock.flow.features.push({
      name: "screens",
      description: { scenes: [wardScene], projections: PROJECTIONS }
    });
    mock.start();
    mock.renderer.host.ready.mockReturnValue(ready);
    mock.world.mode = world;
    await mock.enter({ rest: true, scene: "ward" }, { mode });

    expect(mock.world.holds).toEqual([]);
    expect(mock.state.held).toBeUndefined();
  });

  // Bug: a scene holds a loader it lists itself, one whose layer it does not declare (the hold throws or the layer is
  // lifted from nowhere), one no feature brings, or one another owner shows (hidden by the hold).
  it.each([
    ["it lists", "lobby", undefined],
    ["whose layer it does not declare", "board", undefined],
    ["no feature brings", "ward", "nowhere"],
    ["another owner shows", "ward", "shown"]
  ] as const)("holds no loader %s", async (_case, scene, projection) => {
    const mock = createMockScenes({
      buildMs: "auto",
      leave: {
        loader: { projection: projection === "shown" ? "loading" : (projection ?? "loading") }
      }
    });

    mock.flow.features.push({
      name: "screens",
      description: { scenes: [wardScene, boardScene, lobbyScene], projections: PROJECTIONS }
    });
    mock.start();
    mock.renderer.host.ready.mockReturnValue(true);
    mock.world.building.done = true;
    if (projection === "shown") {
      mock.world.viewLayers = { loading: "loading" };
      mock.world.live.add("loading");
    }
    await mock.enter({ rest: true, scene });

    expect(mock.world.holds).toEqual([]);
  });

  // Bug: a hold the world refuses (a `lift` the scene does not declare) rejects the switch after its swap, or is
  // recorded as held, so the due shows a projection nobody holds.
  it("warns a hold the world refuses, holds nothing, and still stands", async () => {
    const mock = createMockScenes(LOADING);

    mock.flow.features.push({
      name: "screens",
      description: { scenes: [wardScene], projections: PROJECTIONS }
    });
    mock.start();
    mock.renderer.host.ready.mockReturnValue(true);
    mock.world.building.done = true;
    mock.world.holdError = new Error('[game] Projection "loading" names layer "lifted".');
    await mock.enter({ rest: true, scene: "ward" });

    expect(mock.state.current).toBe("ward");
    expect(mock.state.held).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "scenes:loader-unmounted",
      expect.objectContaining({ projection: "loading", scene: "ward" })
    );
  });
});

describe("the due of a held loader", () => {
  // Bug: the due mounts the held loader again (a second spawn in the switch frame), or reads its layer from views that
  // the show brings only in the next frame and draws the ring.
  it("shows it and answers the layer of its spec, with no mount", async () => {
    const mock = await standing("ward");

    await switchTo(mock, "board");

    expect(due(mock)).toBe("loading");
    expect(mock.world.shows).toEqual(["loading"]);
    expect(mock.world.mounted.flatMap(entry => entry.names)).not.toContain("loading");
    expect(mock.state.held).toBeUndefined();
  });

  // Bug: the due shows a name the scene being left never held (a blank loader): a scene that stood headless mounts its
  // loader when it is due, as in A2.
  it("mounts a loader the scene being left does not hold, as A2 does", async () => {
    const mock = await standing("ward", LOADING, false);

    mock.world.viewLayers = { loading: "loading" };
    await switchTo(mock, "board");

    expect(due(mock)).toBe("loading");
    expect(mock.world.mounted.at(-1)?.names).toEqual(["loading"]);
    expect(mock.world.shows).toEqual([]);
  });

  // Bug: a held loader in a layer the scene being left draws in too is shown, and the whole layer rises above the veil
  // with the scene's own views.
  it("gives the ring and unmounts it when a projection of the scene being left draws in its layer", async () => {
    const mock = await standing("home", {
      buildMs: "auto",
      leave: { loader: { projection: "overlay" } }
    });

    mock.world.viewLayers = { "home.menu": "ui" };
    mock.world.live.add("home.menu");
    await switchTo(mock, "board");

    expect(due(mock)).toBeUndefined();
    expect(mock.world.shows).toEqual([]);
    expect(mock.world.unmounted).toContainEqual(["overlay"]);
    expect(mock.log.warn).toHaveBeenCalledWith("scenes:loader-layer-shared", {
      projection: "overlay",
      layer: "ui",
      scene: "home"
    });
  });
});

describe("the loader after the swap", () => {
  // Bug: the loader goes at once at the swap and the veil fades out without it (F107 part 3), or it stays mounted over
  // the next scene once the veil is gone.
  it("fades out with the veil and is unmounted in the frame the veil's outMs ran out", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "board");

    due(mock);
    await land(mock, entering);

    expect(mock.renderer.leaves.at(-1)?.call).toBe("land");
    expect(mock.world.unmounted.flat()).not.toContain("loading");

    frames(mock, FADE_FRAMES - 1);

    expect(mock.world.unmounted.flat()).not.toContain("loading");

    frames(mock, 1);

    expect(mock.world.unmounted).toContainEqual(["loading"]);
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: the fade counts game time: a game in slow motion keeps the loader over the next scene twice as long, and one
  // that froze its time (scale 0) keeps it for good.
  it.each([
    ["in slow motion", { delta: 8, scale: 0.5 }, FADE_FRAMES],
    [
      "with its time frozen, one frame of the loop's 50 Hz",
      { delta: 0, scale: 0 },
      Math.ceil(150 / 20)
    ]
  ] as const)("counts the fade in real frame time %s", async (_case, time, count) => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "board");

    mock.time.fps = 50;
    due(mock);
    await land(mock, entering);
    frames(mock, count - 1, time);

    expect(mock.world.unmounted.flat()).not.toContain("loading");

    frames(mock, 1, time);

    expect(mock.world.unmounted).toContainEqual(["loading"]);
  });

  // Bug: a look without a veil leaves a loader fading under nothing, or never unmounts it.
  it("is unmounted at the land when the look has no veil", async () => {
    const mock = await standing("ward", {
      buildMs: "auto",
      leave: { cover: false, loader: { projection: "loading" } }
    });
    const { entering } = await switchTo(mock, "board");

    due(mock);
    await land(mock, entering);

    expect(mock.world.unmounted).toContainEqual(["loading"]);
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: an abort or a throw fades the loader out over the scene that stays, instead of taking it down with the veil.
  it.each([
    ["an abort", "abort"],
    ["a throw", "throw"]
  ] as const)("is unmounted at once at %s after it was shown", async (_case, how) => {
    const mock = await standing("ward");
    const controller = new AbortController();
    const { entering } = await switchTo(mock, "board", controller.signal);

    due(mock);
    if (how === "abort") controller.abort();
    else mock.assets.fail(new Error("offline"));
    await entering.catch(() => undefined);

    expect(mock.world.unmounted).toEqual([["loading"]]);
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: the next scene, which leaves with the same loader, gets it unmounted after the fade, and its next switch
  // mounts it in the due frame again.
  it("is held again after the fade when the scene that stands leaves with it too", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "home");

    due(mock);
    await land(mock, entering);

    expect(mock.world.holds).toEqual([["loading"]]);

    frames(mock, FADE_FRAMES);

    expect(mock.world.holds).toEqual([["loading"], ["loading"]]);
    expect(mock.world.unmounted.flat()).not.toContain("loading");
    expect(mock.state.held).toEqual({ name: "loading", layer: "loading" });
  });

  // Bug: a loader no switch showed is unmounted at the swap and built again from nothing, though the next scene leaves
  // with it too; or it stays placed under the layers of the scene that left.
  it("stays held, placed again under the next scene, when no switch showed it", async () => {
    const mock = await standing("ward");

    const { entering } = await switchTo(mock, "home");

    await land(mock, entering);

    expect(mock.world.holds).toEqual([["loading"], ["loading"]]);
    expect(mock.world.unmounted.flat()).not.toContain("loading");
    expect(mock.state.held?.name).toBe("loading");
  });

  // Bug: a held loader the next switch does not use stays mounted and built for good, under a scene that never shows
  // it, or the new scene's own loader is not held.
  it.each([
    ["a scene that does not declare its layer", "board", undefined],
    ["a scene that leaves with nothing", "quiet", undefined],
    ["a scene that leaves with another projection", "spin", "spinner"]
  ] as const)("is unmounted at the swap to %s", async (_case, scene, next) => {
    const mock = await standing("ward");

    const { entering } = await switchTo(mock, scene);

    await land(mock, entering);

    expect(mock.world.unmounted).toContainEqual(["loading"]);
    expect(mock.state.held?.name).toBe(next);
  });

  // Bug: a held loader the coming scene lists stays held, and the scene's own projection shows nothing.
  it("is unmounted before the coming scene that lists it is built", async () => {
    const mock = await standing("ward");

    mock.world.calls.length = 0;
    const { entering } = await switchTo(mock, "lobby");

    await land(mock, entering);

    expect(mock.world.calls.indexOf("unmount")).toBeLessThan(mock.world.calls.indexOf("build"));
    expect(mock.world.unmounted[0]).toEqual(["loading"]);
    expect(mock.state.held).toBeUndefined();
  });

  // Bug: the loader still fading after a swap stays over the next switch's look, or its fade unmounts it later under
  // that switch.
  it("goes at once when the next switch starts while it fades", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "board");

    due(mock);
    await land(mock, entering);
    mock.renderer.sync.leave.show.mockImplementation(() => {
      expect(mock.world.unmounted).toContainEqual(["loading"]);
    });
    await mock.stage("begin", { rest: true, scene: "ward" });

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledTimes(2);
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: a stop during the fade leaves its frame callback, which calls the stopped world later.
  it("forgets the fade and the held loader at a stop", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "home");

    due(mock);
    await land(mock, entering);
    mock.stop();

    expect(mock.time.callbacks.signals).toEqual([]);
    expect(mock.state.fading).toBeUndefined();
    expect(mock.state.held).toBeUndefined();
  });
});
