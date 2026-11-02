import { describe, expect, it } from "vitest";
import type { SceneSwitch } from "../../../world/types";
import { defineScene } from "../../define";
import type { Config } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of the switch a leave loader projection reads (F107 part 1): `world.projection.feed` hands its `from`
// `{ from, to, progress }`. A held loader is fed the scene that stands right after its hold; a switch feeds it the
// scene left, the scene entered and the share of its bundles loaded, from the hook of `assets:bundle-progress` and
// from the scene stage once its loads are in, in steps of 0.01 counted in thousandths. The fake world records every
// feed with the world call made last before it; the fake assets answers `isLoaded` false for the bundles of `cold`.
// ---------------------------------------------------------------------------

/** The ward: declares the loader's layer, so it holds the loader. */
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {}, loading: {} },
  projections: [{ name: "ward.room", layer: "room" }]
});

/** The home: declares the loader's layer too, and leaves with the same loader. */
const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {}, loading: {} },
  projections: []
});

/** The board: one bundle. */
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [{ name: "board.cells", layer: "cells" }]
});

/** The episode: its own bundle and the episode's art. */
const episodeScene = defineScene("episode", {
  bundle: "episode",
  bundles: () => ["ep01"],
  layers: { room: {} },
  projections: []
});

/** A scene whose `bundles` throws. */
const brokenScene = defineScene("broken", {
  bundle: "broken",
  bundles: () => {
    throw new Error("no episode");
  },
  layers: { room: {} },
  projections: []
});

/** The projections the features bring. */
const PROJECTIONS = [{ name: "loading", layer: "loading" }];

/** A config whose loader is the projection "loading". */
const LOADING: Config = { buildMs: "auto", leave: { loader: { projection: "loading" } } };

/** Frames of 16 ms until the engine's 150 ms fade-out ran out. */
const FADE_FRAMES = Math.ceil(150 / 16);

/**
 * Gives the pending promise callbacks of the switch their turns.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Starts the plugin and stands a first scene with a drawing renderer, a live world and a build that commits at once.
 * Every load is held from now on until the test releases it.
 *
 * @param first - The scene that stands first.
 * @param ready - Whether the renderer draws when the first scene stands.
 * @returns The started mock.
 */
async function standing(first: string, ready = true): Promise<MockScenes> {
  const mock = createMockScenes(LOADING);

  mock.flow.features.push({
    name: "screens",
    description: {
      scenes: [wardScene, homeScene, boardScene, episodeScene, brokenScene],
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
 * @returns The switch, in a wrapper: an async function would wait for it.
 */
async function switchTo(
  mock: MockScenes,
  scene: string,
  signal?: AbortSignal
): Promise<{ entering: Promise<void> }> {
  const entering = mock.enter({ rest: true, scene }, signal === undefined ? {} : { signal });

  entering.catch(() => undefined);
  await flush();

  return { entering };
}

/**
 * Calls the loader's `due` the renderer was handed last.
 *
 * @param mock - The mock with a switch at its start.
 * @returns What the due answers.
 */
function due(mock: MockScenes): string | undefined {
  const call = mock.renderer.sync.leave.show.mock.calls.at(-1)?.[0].loader?.due;

  if (call === undefined) throw new Error("the look has no due loader");

  return call();
}

/**
 * The values fed to the loader "loading", in order.
 *
 * @param mock - The mock.
 * @returns The switches.
 */
function fedValues(mock: MockScenes): SceneSwitch[] {
  return mock.world.feeds.filter(entry => entry.name === "loading").map(entry => entry.sw);
}

/**
 * The progress of every value fed since a count of feeds.
 *
 * @param mock - The mock.
 * @param since - How many feeds came before.
 * @returns The progress values.
 */
function progressSince(mock: MockScenes, since: number): number[] {
  return fedValues(mock)
    .slice(since)
    .map(sw => sw.progress);
}

/**
 * Sends the files of a bundle, one progress event each, the way `assets` does.
 *
 * @param mock - The mock.
 * @param bundle - The bundle.
 * @param total - Its files.
 */
function settleFiles(mock: MockScenes, bundle: string, total: number): void {
  for (let loaded = 1; loaded <= total; loaded += 1) {
    mock.hooks["assets:bundle-progress"]({ bundle, loaded, total });
  }
}

/**
 * Loads the cold bundles the switch waits for: `isLoaded` answers true for them from now on, and the scene stage's
 * loads resolve.
 *
 * @param mock - The mock with a switch at its bundle wait.
 */
async function loadsIn(mock: MockScenes): Promise<void> {
  mock.assets.cold.clear();
  mock.assets.release();
  await flush();
}

describe("the switch a held loader reads", () => {
  // Bug: the loader built while the ward stands reads no switch (`undefined`) or the last one, so the show writes a
  // stale screen; or the feed comes after another world call and is not the value the held view is built for.
  it("is the scene that stands, fed right after the hold", async () => {
    const mock = await standing("ward");

    expect(mock.world.feeds).toEqual([
      { name: "loading", sw: { from: "ward", to: "ward", progress: 0 }, after: "hold" }
    ]);
  });

  // Bug: the loader held again after its fade keeps the switch it showed (the old scene), or a fading loader is fed
  // the scene that stands while it still fades out over it.
  it("is fed again at the re-hold after a fade, and not while it fades", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "home");

    due(mock);
    mock.assets.release();
    await entering;

    const fed = mock.world.feeds.length;

    mock.time.frame();

    expect(mock.world.feeds).toHaveLength(fed);
    expect(fedValues(mock).at(-1)).toEqual({ from: "ward", to: "home", progress: 1 });

    for (let frame = 1; frame < FADE_FRAMES; frame += 1) mock.time.frame();

    expect(mock.world.feeds.at(-1)).toEqual({
      name: "loading",
      sw: { from: "home", to: "home", progress: 0 },
      after: "hold"
    });
  });
});

describe("the switch a due loader reads", () => {
  // Bug: the loader due on a switch reads the scene that stood (`to: "ward"`), so it names the wrong destination.
  it.each([
    ["held while the ward stood", true],
    ["mounted at its due (A2)", false]
  ] as const)("goes to the board when it is %s", async (_case, ready) => {
    const mock = await standing("ward", ready);

    mock.world.viewLayers = { loading: "loading" };
    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    due(mock);

    expect(fedValues(mock).at(-1)).toEqual({ from: "ward", to: "board", progress: 0 });
    expect(mock.world.calls.at(-1)).toBe(ready ? "show" : "mount");
  });

  // Bug: a projection another owner shows is fed the switch, and its live screen changes under the veil.
  it("is never fed to a projection another owner shows", async () => {
    const mock = await standing("board");

    mock.world.viewLayers = { loading: "loading" };
    mock.world.live.add("loading");
    await switchTo(mock, "ward");
    mock.hooks["assets:bundle-progress"]({ bundle: "ward", loaded: 1, total: 2 });

    expect(mock.world.feeds).toEqual([]);
  });
});

describe("the progress of a switch", () => {
  // Bug: the progress is fed per bundle instead of as the mean, skips steps, or a feed reuses one object changed in
  // place, which the world compares equal to itself and ignores.
  it("feeds 0.125 to 1 for two bundles of four files, a new object each time", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("episode");
    mock.assets.cold.add("ep01");
    await switchTo(mock, "episode");
    settleFiles(mock, "episode", 4);
    settleFiles(mock, "ep01", 4);
    await loadsIn(mock);

    const values = fedValues(mock).slice(1);

    expect(values.map(sw => sw.progress)).toEqual([
      0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1
    ]);
    expect(values.every(sw => sw.from === "ward" && sw.to === "episode")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  // Bug: a bundle loaded before the switch counts 0 and the loader waits for events that never come.
  it("counts a bundle loaded already as whole", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("ep01");
    await switchTo(mock, "episode");

    expect(progressSince(mock, 1)).toEqual([0.5]);
  });

  // Bug: a switch whose bundles are all in feeds 0 and stays there; or it feeds again on an event or at the scene
  // stage.
  it("is 1 at the start when every bundle is in, and feeds no more", async () => {
    const mock = await standing("ward");

    await switchTo(mock, "episode");
    settleFiles(mock, "episode", 2);
    await loadsIn(mock);

    expect(progressSince(mock, 1)).toEqual([1]);
  });

  // Bug: a bundle with no file sends no progress event, so the loader never reaches 1.
  it("counts a bundle with no file whole once the scene stage has its loads in", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    await loadsIn(mock);

    expect(progressSince(mock, 1)).toEqual([0, 1]);
  });

  // Bug: the progress is a float sum, so a bundle of three files ends on 0.999 and the loader never shows full.
  it("feeds exactly 1 last", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    settleFiles(mock, "board", 3);

    expect(progressSince(mock, 1)).toEqual([0, 0.333, 0.666, 1]);
  });

  // Bug: the loader waits for a full step that never comes: the last file of 113 moves 0.991 to 1, below 0.01, and
  // the loader stays short of full.
  it("feeds 1 when the last file moves it by less than a step", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    settleFiles(mock, "board", 113);

    expect(progressSince(mock, 1).slice(-2)).toEqual([0.991, 1]);
  });

  // Bug: every file of a large bundle feeds the loader (200 reconciles of a shown loader in one switch), or the step
  // rounds so the last one is lost.
  it("feeds 101 times for one bundle of 200 files: the start and 100 steps", async () => {
    const mock = await standing("ward");

    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    settleFiles(mock, "board", 200);
    await loadsIn(mock);

    const values = progressSince(mock, 1);

    expect(values).toHaveLength(101);
    expect(values.at(1)).toBe(0.01);
    expect(values.at(-1)).toBe(1);
  });

  // Bug: an event of a bundle the switch does not name (a preload, a companion) moves its progress, or an event with
  // no switch running throws or feeds the held loader.
  it("does nothing for a bundle outside the switch, or with no switch", async () => {
    const mock = await standing("ward");

    mock.hooks["assets:bundle-progress"]({ bundle: "board", loaded: 1, total: 2 });
    mock.assets.cold.add("board");
    await switchTo(mock, "board");
    mock.hooks["assets:bundle-progress"]({ bundle: "ep01", loaded: 2, total: 2 });

    expect(progressSince(mock, 1)).toEqual([0]);
  });

  // Bug: the hooks feed the loader after the swap (a value over the next scene's fading loader) or after a drop
  // (a reconcile of a projection that was unmounted).
  it.each([
    ["the swap", "land"],
    ["the drop", "drop"]
  ] as const)("feeds no more after %s", async (_case, how) => {
    const mock = await standing("ward");
    const controller = new AbortController();

    mock.assets.cold.add("board");
    const { entering } = await switchTo(mock, "board", controller.signal);

    due(mock);
    if (how === "land") mock.assets.release();
    else controller.abort();
    await entering;

    const fed = mock.world.feeds.length;

    settleFiles(mock, "board", 2);

    expect(mock.world.feeds).toHaveLength(fed);
  });

  // Bug: a `bundles` that throws at `begin` throws out of the begin stage (which must not throw), or its loader stays
  // at 0; the scene stage must still throw it as before.
  it("is 1 when the scene's bundles throw at begin, and the scene stage throws", async () => {
    const mock = await standing("ward");
    const { entering } = await switchTo(mock, "broken");

    await expect(entering).rejects.toThrow("no episode");
    expect(fedValues(mock).at(1)).toEqual({ from: "ward", to: "broken", progress: 1 });
  });
});
