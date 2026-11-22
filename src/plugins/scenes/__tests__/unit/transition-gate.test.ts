import { afterEach, describe, expect, it, vi } from "vitest";
import { defineScene } from "../../define";
import type { Config, SceneDefinition, SceneEnter, SceneLeave } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of the swap gate of a transition (spec 36) in `scenes`, over the fake renderer whose `sync.leave.capture`
// answers what the test queues: the build that is done waits for the picture of the last frame, commits when it is
// taken and plays it in the same frame, gives up after 3 frames, and asks nothing on any path that cannot play one.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The transition the scenes below leave with, as the renderer is handed it: every default filled in. */
const FADE = { kind: "fade", ms: 400, ease: "inOut", reduced: "cut" };

/** The engine's veil, what a game that writes nothing gets. */
const VEIL = { color: 0x00_00_00, alpha: 0.45, inMs: 50, outMs: 150 };

/** The frames of the veil's fade-out: a loader fades out with it unless a transition played. */
const FADE_FRAMES = Math.ceil(VEIL.outMs / 16);

/**
 * A home scene that leaves with what a test writes.
 *
 * @param leave - The `leave` of the scene: a value or a function of the switch.
 * @returns The scene.
 */
function homeLeaving(leave: SceneLeave | ((sw: { from: string; to: string }) => SceneLeave)) {
  return defineScene("home", {
    bundle: "home",
    layers: { ui: {}, loading: {} },
    projections: [{ name: "home.menu", layer: "ui" }],
    leave
  });
}

/**
 * A board scene that is entered with what a test writes.
 *
 * @param enter - The `enter` of the scene.
 * @returns The scene.
 */
function boardEntered(enter?: SceneEnter) {
  return defineScene("board", {
    bundle: "board",
    layers: { cells: {} },
    projections: [{ name: "board.cells", layer: "cells" }],
    ...(enter === undefined ? {} : { enter })
  });
}

/**
 * Gives the pending promise callbacks of the switch their turns: the loads and the warm.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Starts the plugin with home mounted in one block and the renderer drawing from now on: the next live switch builds
 * aside, and its build is done from the start, so only the gate holds the swap.
 *
 * @param home - The scene that stands.
 * @param options - The config, and the scene entered.
 * @param options.config - The config of the plugin.
 * @param options.board - The scene the switch goes to.
 * @returns The started mock, home current.
 */
async function onHome(
  home: SceneDefinition,
  options: { config?: Config; board?: SceneDefinition } = {}
): Promise<MockScenes> {
  const mock = createMockScenes(options.config);

  mock.flow.features.push({
    name: "screens",
    description: { scenes: [home, options.board ?? boardEntered()] }
  });
  mock.start();
  await mock.enter({ rest: true, scene: home.id });
  mock.renderer.host.ready.mockReturnValue(true);
  mock.world.building.done = true;
  mock.world.calls.length = 0;
  mock.journal.length = 0;
  mock.renderer.leaves.length = 0;

  return mock;
}

/**
 * Starts the switch to the board and lets it reach the build.
 *
 * @param mock - The mock on home.
 * @param signal - The abort signal of the board's node.
 * @returns The switch, and whether it settled yet.
 */
async function enterBoard(
  mock: MockScenes,
  signal?: AbortSignal
): Promise<{ entering: Promise<void>; settled: { done: boolean } }> {
  const settled = { done: false };
  const entering = mock
    .enter({ rest: true, scene: "board" }, signal === undefined ? {} : { signal })
    .finally(() => {
      settled.done = true;
    });

  entering.catch(() => undefined);
  await flush();

  return { entering, settled };
}

/** The scene home leaves with a fade and nothing else written. */
const FADING = (): SceneDefinition => homeLeaving({ transition: { kind: "fade" } });

describe("the swap gate", () => {
  // Bug: the swap commits before the picture is taken, so the swap frame has no picture to draw over the new scene; or
  // `play` waits for the frame after the swap and the new scene shows bare for one frame.
  it("holds the swap on `wait`, then commits and plays in the frame the picture is ready", async () => {
    const mock = await onHome(FADING());

    mock.renderer.captures.push("wait", "ready");
    const { entering, settled } = await enterBoard(mock);

    // The first call asked for the picture: no commit, the loop is kept awake for the frame that copies it.
    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(1);
    expect(mock.world.calls).not.toContain("commit");
    expect(mock.state.current).toBe("home");
    expect(settled.done).toBe(false);
    expect(mock.journal.slice(mock.journal.indexOf("renderer:capture"))).toEqual([
      "renderer:capture",
      "time:wake"
    ]);

    mock.time.frame();

    // In the very frame of the `ready` answer, and not one later: the commit, the swap's own calls, then the play.
    expect(mock.renderer.sync.leave.play).toHaveBeenCalledTimes(1);
    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(2);
    expect(mock.state.current).toBe("board");
    expect(mock.journal.filter(call => /commit|scenes:changed|play/.test(call))).toEqual([
      "world:commit",
      "emit:scenes:changed",
      "renderer:play"
    ]);

    await entering;

    expect(mock.renderer.leaves.map(entry => [entry.call, entry.current])).toEqual([
      ["show", "home"],
      ["play", "board"],
      ["land", "board"]
    ]);
  });

  // Bug: a look that carries a transition is handed to the renderer without it, or with the game's own object.
  it("hands the renderer the resolved transition in the look", async () => {
    const mock = await onHome(FADING());

    await enterBoard(mock);

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400 },
      transition: FADE
    });
  });

  // Bug: `none` (WebGL, a lost device, reduced motion that cuts) waits for a picture that never comes, or plays one.
  it("commits at once on `none` and plays nothing", async () => {
    const mock = await onHome(FADING());

    mock.renderer.captures.push("none");
    const { entering } = await enterBoard(mock);

    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(1);
    expect(mock.state.current).toBe("board");
    await entering;

    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "land"]);
  });

  // Bug: a renderer that never answers `ready` holds the swap for good: the player stares at the old scene.
  it("commits without the transition after 3 frames of waiting", async () => {
    const mock = await onHome(FADING());

    mock.renderer.captures.push("wait");
    const { entering } = await enterBoard(mock);

    mock.time.frame();
    mock.time.frame();

    // The asking call and two frames: three waits, still held.
    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(3);
    expect(mock.state.current).toBe("home");

    mock.time.frame();
    await entering;

    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(4);
    expect(mock.state.current).toBe("board");
    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
    // The look lands as today: the renderer frees a picture asked for and not played.
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "land"]);
  });

  // Bug: an abort while the swap waits leaves the picture asked for, or commits the scene of an aborted node.
  it("drops the look at an abort while it waits, and commits nothing", async () => {
    const mock = await onHome(FADING());
    const controller = new AbortController();

    mock.renderer.captures.push("wait");
    const { entering } = await enterBoard(mock, controller.signal);

    controller.abort();
    await entering;
    mock.time.frame();

    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "drop"]);
    expect(mock.world.calls).not.toContain("commit");
    expect(mock.world.calls).toContain("discard");
    expect(mock.state.current).toBe("home");
    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(1);
  });

  // Bug: the gate asks while the floor of the loader (`holdMs`) still holds the swap, so the picture is taken early and
  // the frames of the floor show on the old scene after it.
  it("asks for the picture only once the swap may commit: the floor of the loader passed", async () => {
    const mock = await onHome(
      homeLeaving({ loader: { holdMs: 260 }, transition: { kind: "fade" } })
    );

    mock.renderer.captures.push("ready");
    const { entering } = await enterBoard(mock);

    // The build is done and the floor holds: nothing is asked for.
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();

    // The clock passed the floor, but the look was drawn in no frame yet after its start.
    mock.clock.at += 300;
    mock.time.frame();
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();

    mock.time.frame();
    await entering;

    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(1);
    expect(mock.renderer.sync.leave.play).toHaveBeenCalledTimes(1);
  });
});

describe("the paths that play no transition", () => {
  // Bug: the gate asks on every switch, so a game with no transition waits a frame at each of them.
  it("asks no capture without a transition in the look", async () => {
    const mock = await onHome(homeLeaving({ cover: { alpha: 0.3 } }));

    mock.renderer.captures.push("wait");
    const { entering } = await enterBoard(mock);

    await entering;

    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();
    expect(mock.state.current).toBe("board");
  });

  // Bug: the one-block path (a refused build, where the swap is synchronous) waits for a frame it cannot wait for,
  // or plays a picture nobody asked for.
  it("asks no capture on the one-block path of a refused build", async () => {
    const mock = await onHome(FADING());

    mock.renderer.captures.push("ready");
    mock.world.building.answer = false;
    await mock.enter({ rest: true, scene: "board" });

    expect(mock.state.current).toBe("board");
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();
    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "land"]);
  });

  // Bug: a fast walk, a headless app or the first scene of a run shows a look with a transition in it.
  it.each([
    ["a fast walk", "fast"],
    ["a headless app", "headless"],
    ["the first scene of a run", "first"]
  ] as const)("shows no look and asks no capture in %s", async (_case, how) => {
    const home = FADING();
    const mock = createMockScenes();

    mock.flow.features.push({ name: "screens", description: { scenes: [home, boardEntered()] } });
    mock.start();
    mock.renderer.captures.push("ready");
    mock.world.building.done = true;

    if (how === "first") {
      mock.renderer.host.ready.mockReturnValue(true);
      await mock.enter({ rest: true, scene: "home" });
    } else {
      await mock.enter({ rest: true, scene: "home" });
      mock.renderer.host.ready.mockReturnValue(how !== "headless");
      await mock.enter({ rest: true, scene: "board" }, how === "fast" ? { mode: "fast" } : {});
    }

    expect(mock.renderer.sync.leave.show).not.toHaveBeenCalled();
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();
    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
  });

  // Bug: a world that stopped running live during the wait is still held for a picture, or plays one over a scene
  // mounted in one block.
  it("mounts in one block when the world stops running live while it waits, and plays nothing", async () => {
    const mock = await onHome(FADING());

    mock.renderer.captures.push("wait", "ready");
    const { entering } = await enterBoard(mock);

    mock.world.mode = "fast";
    mock.time.frame();
    await entering;

    expect(mock.state.current).toBe("board");
    expect(mock.renderer.sync.leave.capture).toHaveBeenCalledTimes(1);
    expect(mock.renderer.sync.leave.play).not.toHaveBeenCalled();
    expect(mock.renderer.leaves.map(entry => entry.call)).toEqual(["show", "land"]);
  });
});

describe("a look of a transition alone", () => {
  // Bug: with the veil and the loader both off no look is shown, so the transition is never asked for.
  it("is shown and played when `cover` and `loader` are `false`", async () => {
    const mock = await onHome(
      homeLeaving({ cover: false, loader: false, transition: { kind: "fade" } })
    );

    mock.renderer.captures.push("ready");
    const { entering } = await enterBoard(mock);

    await entering;

    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({ transition: FADE });
    expect(mock.renderer.sync.leave.play).toHaveBeenCalledTimes(1);
    expect(mock.state.current).toBe("board");
  });

  // Bug: the scene entered is not read: its `enter.transition` never reaches the renderer.
  it("takes the `enter.transition` of the scene entered over the one the scene left writes", async () => {
    const mock = await onHome(FADING(), {
      board: boardEntered({ transition: { kind: "iris", ms: 500, y: 0.2 } })
    });

    await enterBoard(mock);

    expect(mock.renderer.sync.leave.show.mock.calls[0]?.[0].transition).toEqual({
      kind: "iris",
      ms: 500,
      ease: "inOut",
      reduced: "cut",
      x: 0.5,
      y: 0.2,
      soft: 0.05
    });
  });

  // Bug: `transition: false` of the scene left still shows the transition of the scene entered.
  it("shows none when the scene left turns it off, whatever the scene entered writes", async () => {
    const mock = await onHome(homeLeaving({ transition: false }), {
      board: boardEntered({ transition: { kind: "iris" } })
    });

    mock.renderer.captures.push("wait");
    const { entering } = await enterBoard(mock);

    await entering;

    expect(mock.renderer.sync.leave.show.mock.calls[0]?.[0]).not.toHaveProperty("transition");
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();
  });
});

describe("a `leave` function that gives a bad transition", () => {
  // Bug: a game's function that gives a transition out of range ends the switch, or plays it; it is logged and the
  // config's look shows, as for any bad result.
  it("is logged as `scenes:leave-failed`, and the config's look shows without a transition", async () => {
    const mock = await onHome(homeLeaving(() => ({ transition: { kind: "fade", ms: 0 } })));

    mock.renderer.captures.push("ready");
    const { entering } = await enterBoard(mock);

    await entering;

    expect(mock.log.error).toHaveBeenCalledExactlyOnceWith("scenes:leave-failed", {
      scene: "home",
      to: "board",
      error: expect.objectContaining({
        message: expect.stringContaining('Scene "home": leave.transition.ms is 0.')
      })
    });
    expect(mock.renderer.sync.leave.show).toHaveBeenCalledExactlyOnceWith({
      cover: VEIL,
      loader: { afterMs: 400 }
    });
    expect(mock.renderer.sync.leave.capture).not.toHaveBeenCalled();
  });

  // Bug: a function that gives a good transition is read only as a value, so it never plays.
  it("plays what a good one gives", async () => {
    const mock = await onHome(
      homeLeaving(sw => (sw.to === "board" ? { transition: { kind: "slide", to: "up" } } : {}))
    );

    mock.renderer.captures.push("ready");
    const { entering } = await enterBoard(mock);

    await entering;

    expect(mock.renderer.sync.leave.show.mock.calls[0]?.[0].transition).toMatchObject({
      kind: "slide",
      to: "up"
    });
    expect(mock.renderer.sync.leave.play).toHaveBeenCalledTimes(1);
  });
});

/** A config whose loader is the projection "loading". */
const LOADING: Config = { buildMs: "auto", leave: { loader: { projection: "loading" } } };

/**
 * Starts the switch to the board with its loader due and mounted, the build not done yet.
 *
 * @param mock - The mock on home.
 * @returns The switch.
 */
async function dueSwitch(mock: MockScenes): Promise<{ entering: Promise<void> }> {
  mock.world.viewLayers = { loading: "loading" };
  mock.world.building.done = false;

  const { entering } = await enterBoard(mock);

  mock.renderer.sync.leave.show.mock.calls.at(-1)?.[0].loader?.due?.();
  mock.world.building.done = true;

  return { entering };
}

describe("the loader projection after a played transition", () => {
  // Bug: the loader projection fades out for the veil's `outMs` over the new scene after a played transition, though
  // it is in the picture already: it would show twice.
  it("is unmounted at once when the transition played", async () => {
    const mock = await onHome(FADING(), { config: LOADING });

    mock.renderer.captures.push("ready");
    const { entering } = await dueSwitch(mock);

    mock.time.frame();
    await entering;

    expect(mock.renderer.sync.leave.play).toHaveBeenCalledTimes(1);
    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });

  // Bug: the loader goes at once for every switch with a transition in its look, also one that did not play it (the
  // gate gave up, `none`): the loader then vanishes under a veil that is still fading.
  it("still fades out with the veil when no transition played", async () => {
    const mock = await onHome(FADING(), { config: LOADING });

    mock.renderer.captures.push("none");
    const { entering } = await dueSwitch(mock);

    mock.time.frame();
    await entering;

    expect(mock.world.unmounted.flat()).not.toContain("loading");

    for (let frame = 0; frame < FADE_FRAMES; frame += 1) mock.time.frame();

    expect(mock.world.unmounted.at(-1)).toEqual(["loading"]);
  });
});
