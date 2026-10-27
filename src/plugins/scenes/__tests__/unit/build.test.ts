import { afterEach, describe, expect, it, vi } from "vitest";
import { defineScene } from "../../define";
import type { Config, RunContext } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

// ---------------------------------------------------------------------------
// Unit test of the next scene built aside (spec 31, F61 S2) in `scenes`: the path a switch takes,
// the build start, the commit the frame `world.projection.built()` first answers true, in the
// order of a one-block switch, the abort, a throwing build or commit, and a stop during the build.
// The fakes record every call in one journal, so the order of the swap is read as it happened.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {} },
  projections: [{ name: "home.menu", layer: "ui" }],
  music: "home.theme"
});

const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {}, items: { sort: "y" } },
  projections: [
    { name: "board.cells", layer: "cells" },
    { name: "board.items", layer: "items" }
  ]
});

/**
 * Gives the pending promise callbacks of the switch their turns: the loads and the warm.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Draws the reaction frame of a live switch and runs the `signals` phase of the next frame, where the build starts
 * (slice R).
 *
 * @param mock - The mock with a switch past its `begin` stage.
 */
async function react(mock: MockScenes): Promise<void> {
  mock.time.phase("render");
  mock.time.phase("signals");
  await flush();
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
 * Starts the plugin with home and board, home mounted in one block, and the renderer drawing from
 * now on: the next live switch builds aside. The journal starts empty.
 *
 * @param config - The config of the plugin.
 * @returns The started mock, home current.
 */
async function onHome(config?: Config): Promise<MockScenes> {
  const mock = createMockScenes(config);

  mock.flow.features.push({ name: "screens", description: { scenes: [homeScene, boardScene] } });
  mock.start();
  await mock.enter({ rest: true, scene: "home" });
  mock.renderer.host.ready.mockReturnValue(true);
  mock.world.calls.length = 0;
  mock.journal.length = 0;
  mock.emitted.length = 0;

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

  await flush();
  await react(mock);

  return { entering, settled };
}

describe("the path of a switch", () => {
  // Bug: a restore or a test walk builds aside and waits for frames a fast walk never shows.
  it("a fast walk mounts in one block while the renderer draws", async () => {
    const mock = await onHome();

    await mock.enter({ rest: true, scene: "board" }, { mode: "fast" });

    expect(mock.world.calls).toEqual(["setLayers", "unmount", "mount"]);
    expect(mock.world.building.calls).toEqual([]);
    expect(mock.state.current).toBe("board");
  });

  // Bug: a headless app (no device) builds aside and waits for a part of the build no renderer does.
  it("a live switch mounts in one block while the renderer draws nothing", async () => {
    const mock = await onHome();

    mock.renderer.host.ready.mockReturnValue(false);
    await mock.enter({ rest: true, scene: "board" });

    expect(mock.world.calls).toEqual(["setLayers", "unmount", "mount"]);
    expect(mock.world.building.calls).toEqual([]);
  });

  // Bug: a node entered live whose world runs fast by now (a repro restore enters its checkpoint live and walks its
  // route fast) builds aside, and the fast world never lays the scene out: the walk waits for its gate for good.
  it.each([
    "fast",
    "paused"
  ] as const)("a live switch mounts in one block while the world runs %s", async mode => {
    const mock = await onHome();

    mock.world.mode = mode;
    await mock.enter({ rest: true, scene: "board" });

    expect(mock.world.calls).toEqual(["setLayers", "unmount", "mount"]);
    expect(mock.state.current).toBe("board");
  });

  // Bug: a build the world refused leaves the switch waiting for a build that never started, or holds the coming
  // bundles; the dev build has to say why the switch did not build aside.
  it("mounts in one block when the world refuses to build aside, and names the scene in a dev build", async () => {
    const plain = await onHome();

    plain.world.building.answer = false;
    await switchTo(plain);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const dev = await onHome();

    dev.world.building.answer = false;
    await switchTo(dev);

    expect(plain.world.calls).toEqual(["build", "setLayers", "unmount", "mount"]);
    expect(plain.state.current).toBe("board");
    expect(plain.assets.coming).toEqual([]);
    expect(plain.log.warn).not.toHaveBeenCalled();
    expect(dev.log.warn).toHaveBeenCalledWith("scenes:build-skipped", {
      scene: "board",
      from: "home",
      projections: ["board.cells", "board.items"]
    });
  });
});

describe("a scene built aside", () => {
  // Bug: the switch commits at the build start, so the board is current and its music starts while it is not drawn.
  it("keeps the old scene current and emits nothing until every part of the build is done", async () => {
    const mock = await onHome();
    const { entering, settled } = await enterBoard(mock);

    mock.time.frame();
    mock.time.frame();
    await flush();

    expect(mock.world.calls).toEqual(["build"]);
    expect(mock.api.current()).toBe("home");
    expect(mock.emitted).toEqual([]);
    expect(mock.assets.coming).toEqual([["board"]]);
    expect(settled.done).toBe(false);

    mock.world.building.done = true;
    mock.time.frame();
    await entering;

    expect(mock.api.current()).toBe("board");
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: "home", to: "board", music: undefined } }
    ]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });

  // Bug: the commit runs the swap in another order than a one-block switch: the world's systems see the new scene
  // before its projections, or `assets` moves the old bundles to leaving before the layers changed.
  it("commits with the calls of a one-block switch, in its order, the commit in the mount's place", async () => {
    const oneBlock = await onHome();

    oneBlock.renderer.host.ready.mockReturnValue(false);
    await oneBlock.enter({ rest: true, scene: "board" });

    const aside = await onHome();
    const { entering } = await enterBoard(aside);

    aside.world.building.done = true;
    aside.time.frame();
    await entering;

    expect(aside.journal.slice(0, 2)).toEqual(["world:build", "assets:sceneComing"]);
    expect(aside.journal.slice(2)).toEqual(
      oneBlock.journal.map(call => (call === "world:mount" ? "world:commit" : call))
    );
    expect(aside.world.layers).toEqual(oneBlock.world.layers);
    expect(aside.world.unmounted).toEqual(oneBlock.world.unmounted);
    expect(aside.assets.named).toEqual(oneBlock.assets.named);
    expect(aside.emitted).toEqual(oneBlock.emitted);
  });

  // Bug: a scene of kept projections only waits a frame for nothing, so every fake-clock test moves by a frame.
  it("commits inside the switch, with no frame, when nothing is left to build", async () => {
    const mock = await onHome();
    const run = { signal: new AbortController().signal };

    // The reaction frame was drawn while the bundles downloaded: the build starts between two frames.
    await mock.stage("begin", { rest: true, scene: "board" }, run);
    mock.time.frame();
    mock.world.building.done = true;
    await mock.stage("scene", { rest: true, scene: "board" }, run);

    expect(mock.world.calls).toEqual(["build", "setLayers", "unmount", "commit"]);
    expect(mock.api.current()).toBe("board");
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: the world gets the layers on screen instead of the coming ones, or never the budget a game configured.
  it("hands the world the coming list, the owner, the coming layers and buildMs", async () => {
    const mock = await onHome({ buildMs: 2 });

    await enterBoard(mock);

    expect(mock.world.building.calls).toEqual([
      {
        names: ["board.cells", "board.items"],
        owner: { kind: "plugin", name: "scenes" },
        layers: boardScene.layers,
        budgetMs: 2
      }
    ]);
  });

  // Bug: "auto" hands the world a fixed number, half a frame or a whole one, or the rate the loop ran at before the
  // switch instead of the one it runs at when the build starts.
  it.each([
    [60, 11.111],
    [120, 5.556]
  ])('hands the world two thirds of a frame for "auto" at %i fps, read at the build start', async (fps, budgetMs) => {
    const mock = await onHome({ buildMs: "auto" });

    mock.time.fps = fps;
    await enterBoard(mock);

    expect(mock.world.building.calls.map(call => call.budgetMs)).toEqual([
      expect.closeTo(budgetMs, 3)
    ]);
  });

  // Bug: a rate of 0 or NaN gives the world an endless budget (the renderer then takes the build for none and draws
  // the coming scene at once) or no number at all.
  it.each([
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('hands the world two thirds of a 60 Hz frame for "auto" when time answers %s fps', async fps => {
    const mock = await onHome({ buildMs: "auto" });

    mock.time.fps = fps;
    await enterBoard(mock);

    expect(mock.world.building.calls.map(call => call.budgetMs)).toEqual([
      expect.closeTo(11.111, 3)
    ]);
  });
});

describe("a scene built aside that does not stand", () => {
  // Bug: a walk that goes fast during the build (the route of a repro) skips the world's layout phase: ui never lays
  // the coming scene out, `built()` never answers true and the walk waits for the gate of this node for good.
  it("a world that stops running live during the build discards it and mounts the scene in one block", async () => {
    const mock = await onHome();
    const { entering } = await enterBoard(mock);

    mock.time.frame();
    mock.world.mode = "fast";
    mock.time.frame();
    await entering;

    expect(mock.world.calls).toEqual(["build", "discard", "setLayers", "unmount", "mount"]);
    expect(mock.api.current()).toBe("board");
    expect(mock.assets.named.at(-1)).toEqual(["board"]);
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: "home", to: "board", music: undefined } }
    ]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });

  // Bug: an abort (a restore, the inbox) leaves the build's entities on the world, the coming bundles held, or the
  // frame callback, which commits the scene of a node that was left.
  it("an abort of the node discards the build and leaves the scene, the bundles and the frames as they were", async () => {
    const mock = await onHome();
    const controller = new AbortController();
    const { entering } = await enterBoard(mock, controller.signal);

    controller.abort("restore");
    await entering;
    mock.world.building.done = true;
    mock.time.frame();

    expect(mock.world.calls).toEqual(["build", "discard"]);
    expect(mock.api.current()).toBe("home");
    expect(mock.world.scenes).toEqual(["home"]);
    expect(mock.state.named).toEqual(["home"]);
    expect(mock.assets.named).toEqual([["home"]]);
    expect(mock.assets.coming).toEqual([["board"], []]);
    expect(mock.emitted).toEqual([]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });

  // Bug: the abort listener outlives the commit, and leaving the board later discards the build of the next scene.
  it("an abort after the commit discards nothing", async () => {
    const mock = await onHome();
    const controller = new AbortController();
    const { entering } = await enterBoard(mock, controller.signal);

    mock.world.building.done = true;
    mock.time.frame();
    await entering;
    controller.abort("inbox");

    expect(mock.world.calls).not.toContain("discard");
    expect(mock.assets.coming).toEqual([["board"]]);
  });

  // Bug: a `view` that throws in the build start leaves the coming bundles held or a frame callback behind.
  it("a build that throws rejects the switch and holds nothing", async () => {
    const mock = await onHome();

    mock.world.building.error = new Error("board.items: view failed");

    await expect(switchTo(mock)).rejects.toThrow("board.items: view failed");
    expect(mock.world.calls).toEqual(["build"]);
    expect(mock.api.current()).toBe("home");
    expect(mock.assets.coming).toEqual([]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });

  // Bug: a commit that throws is swallowed by the frame loop: the switch never settles and the callback stays.
  it("a commit that throws rejects the switch and leaves no frame callback", async () => {
    const mock = await onHome();
    const { entering } = await enterBoard(mock);

    mock.world.building.commitError = new Error("[game] Projection is not registered.");
    mock.world.building.done = true;
    mock.time.frame();

    await expect(entering).rejects.toThrow("[game] Projection is not registered.");
    expect(mock.time.callbacks.signals).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });

  // Bug: a `setLayers` or an `unmount` that throws in the commit frame, before `commit()`, leaves the world's build
  // table set and the coming bundles held: every later live switch throws "A scene is already being built".
  it.each([
    "setLayersError",
    "unmountError"
  ] as const)("a swap whose %s throws discards the build, holds nothing and lets the next build run", async field => {
    const mock = await onHome();
    const { entering } = await enterBoard(mock);

    mock.world[field] = new Error("[game] the swap failed.");
    mock.world.building.done = true;
    mock.time.frame();

    await expect(entering).rejects.toThrow("[game] the swap failed.");
    expect(mock.world.api.projection.built()).toBe(false);
    expect(mock.assets.coming).toEqual([["board"], []]);

    await switchTo(mock);

    expect(mock.world.building.calls).toHaveLength(2);
    expect(mock.api.current()).toBe("board");
  });

  // Bug: the one-block mount of a build given up throws and the coming bundles stay held for good.
  it("a one-block mount that throws after the world went fast holds no coming bundles", async () => {
    const mock = await onHome();
    const { entering } = await enterBoard(mock);

    mock.world.mode = "fast";
    mock.world.mountError = new Error("[game] Projection is not registered.");
    mock.time.frame();

    await expect(entering).rejects.toThrow("[game] Projection is not registered.");
    expect(mock.world.api.projection.built()).toBe(false);
    expect(mock.assets.coming.at(-1)).toEqual([]);
  });

  // Bug: a stop during the build keeps the frame callback, which commits on a stopped app, or leaves the switch
  // pending, so the runner's stop waits for it.
  it("a stop during the build removes the frame callback and lets the switch return", async () => {
    const mock = await onHome();
    const { entering } = await enterBoard(mock);

    mock.stop();
    await entering;
    mock.world.building.done = true;
    mock.time.frame();

    expect(mock.world.calls).toEqual(["build"]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect("build" in mock.state).toBe(false);
  });
});

describe("the reaction frame of a live switch (slice R)", () => {
  // Bug: the build starts in the answer's turn, so the mount of the whole coming scene lands in the first frame after
  // the release and the press look and the veil reach the screen one to three frames late.
  it("starts the build in the signals phase of the frame after the first drawn one, not in the answer's turn", async () => {
    const mock = await onHome();
    const entering = mock.enter({ rest: true, scene: "board" });

    await flush();
    expect(mock.world.building.calls).toEqual([]);
    expect(mock.renderer.sync.leave.show).toHaveBeenCalledOnce();

    mock.time.frame();
    await flush();
    expect(mock.world.building.calls).toEqual([]);

    mock.time.phase("signals");
    expect(mock.world.building.calls).toHaveLength(1);
    expect(mock.time.callbacks.render).toEqual([]);

    mock.world.building.done = true;
    mock.time.frame();
    await entering;
    expect(mock.api.current()).toBe("board");
  });

  // Bug: a build done at its start waits a frame for its swap, or swaps in the middle of a frame's steps (in `input`
  // the frame's own steps released the old scene's bundles before its reconcile started their exit, F51b).
  it("swaps a build done at its start in the signals phase it starts in", async () => {
    const mock = await onHome();
    const entering = mock.enter({ rest: true, scene: "board" });

    await flush();
    mock.time.frame();
    mock.world.building.done = true;
    mock.time.phase("signals");
    await entering;

    expect(mock.world.calls).toEqual(["build", "setLayers", "unmount", "commit"]);
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: the first scene of a run, with nothing on screen to react with, waits a frame for a reaction.
  it("builds the first scene of a run without waiting for a frame", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "screens", description: { scenes: [homeScene, boardScene] } });
    mock.start();
    mock.renderer.host.ready.mockReturnValue(true);
    mock.world.building.done = true;
    await mock.enter({ rest: true, scene: "home" });

    expect(mock.world.building.calls).toHaveLength(1);
    expect(mock.api.current()).toBe("home");
    expect(mock.time.callbacks.render).toEqual([]);
    expect("reaction" in mock.state).toBe(false);
  });

  // Bug: a fast walk or a headless app keeps a watch for a reaction frame no build waits for.
  it("watches nothing for a switch that does not build aside", async () => {
    const mock = await onHome();

    await mock.enter({ rest: true, scene: "board" }, { mode: "fast" });

    expect(mock.time.callbacks.render).toEqual([]);
    expect("reaction" in mock.state).toBe(false);
  });

  // Bug: a cold first visit, whose reaction frame was drawn while its bundles downloaded, waits one more frame.
  it("starts at once when the reaction frame was drawn before the scene stage", async () => {
    const mock = await onHome();
    const run = { signal: new AbortController().signal };

    await mock.stage("begin", { rest: true, scene: "board" }, run);
    mock.time.frame();
    mock.world.building.done = true;
    await mock.stage("scene", { rest: true, scene: "board" }, run);

    expect(mock.world.building.calls).toHaveLength(1);
    expect(mock.api.current()).toBe("board");
    expect(mock.time.callbacks.signals).toEqual([]);
  });

  // Bug: a node aborted while its reaction frame is drawn builds the scene it no longer enters, or never returns.
  it("builds nothing for a node aborted while it waits, and returns", async () => {
    const mock = await onHome();
    const abort = new AbortController();
    const entering = mock.enter({ rest: true, scene: "board" }, { signal: abort.signal });

    await flush();
    abort.abort();
    await entering;
    mock.time.frame();
    mock.time.frame();

    expect(mock.world.building.calls).toEqual([]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect(mock.api.current()).toBe("home");
    expect("reaction" in mock.state).toBe(false);
  });

  // Bug: a restore or a stop that aborts the node in an earlier callback of the frame the build would start in leaves
  // the captured waiting callback to build for the aborted node: its build is never discarded.
  it("builds nothing for a node aborted earlier in the frame its build would start in", async () => {
    const mock = await onHome();
    const abort = new AbortController();
    const off = mock.time.api.onFrame("signals", () => {
      if (mock.world.building.calls.length === 0 && mock.state.reaction?.drawn === true)
        abort.abort();
    });
    const entering = mock.enter({ rest: true, scene: "board" }, { signal: abort.signal });

    await flush();
    mock.time.frame();
    mock.time.frame();
    await entering;
    off();

    expect(mock.world.building.calls).toEqual([]);
    expect(mock.time.errors).toEqual([]);
    expect(mock.api.current()).toBe("home");
  });

  // Bug: a stop while the switch waits for its reaction frame leaves a frame callback and a switch that never returns.
  it("lets the switch return and leaves no frame callback when the plugin stops while it waits", async () => {
    const mock = await onHome();
    const entering = mock.enter({ rest: true, scene: "board" });

    await flush();
    mock.stop();
    await entering;

    expect(mock.world.building.calls).toEqual([]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect(mock.time.callbacks.render).toEqual([]);
  });

  // Bug: a build that throws inside the frame loop is swallowed by the loop: the switch never settles.
  it("rejects the switch with the throw of a build started in a frame, and the frame goes on", async () => {
    const mock = await onHome();
    const entering = mock.enter({ rest: true, scene: "board" });

    entering.catch(() => undefined);
    mock.world.building.error = new Error("board.items: view failed");
    await flush();
    mock.time.frame();
    mock.time.frame();

    await expect(entering).rejects.toThrow("board.items: view failed");
    expect(mock.time.errors).toEqual([]);
    expect(mock.time.callbacks.signals).toEqual([]);
    expect(mock.api.current()).toBe("home");
  });
});

describe("a scene built aside in the performance log", () => {
  // Bug: the perf script cannot tell how long a switch built or with what budget, or an app without the flag logs it.
  it("names the build start, and the commit with the frames, the page milliseconds and the budget, in an agent build only", async () => {
    const plain = await onHome();
    const plainBuild = await enterBoard(plain);

    plain.world.building.done = true;
    plain.time.frame();
    await plainBuild.entering;

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const agent = await onHome();

    agent.time.clock = { now: 100 };
    agent.renderer.monitor.event.mockClear();

    const { entering } = await enterBoard(agent);

    agent.time.frame();
    agent.time.frame();
    agent.time.clock.now = 130;
    agent.world.building.done = true;
    agent.time.frame();
    await entering;

    expect(plain.renderer.monitor.event).not.toHaveBeenCalled();
    expect(agent.renderer.monitor.event.mock.calls).toEqual([
      ["scene:build", { from: "home", to: "board" }],
      [
        "scene",
        {
          from: "home",
          to: "board",
          buildFrames: 3,
          buildMs: 30,
          budgetMs: expect.closeTo(11.111, 3)
        }
      ]
    ]);
  });
});
