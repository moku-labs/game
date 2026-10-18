import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../model/types";
import { defineScene } from "../../define";
import type { SceneDefinition, SceneState } from "../../types";
import { createMockScenes, type MockScenes } from "./mock-scenes";

const homeScene = defineScene("home", {
  bundle: "home",
  layers: { ui: {} },
  projections: [],
  music: "home.theme"
});

const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {}, items: { sort: "y" }, lifted: {} },
  projections: [
    { name: "board.cells", layer: "cells" },
    { name: "board.items", layer: "items", lift: "lifted" }
  ]
});

/**
 * Starts the plugin with two scenes registered by one feature.
 *
 * @param scenes - What the feature declares. Defaults to home and board.
 * @returns The started mock.
 */
function startedMock(scenes: readonly SceneDefinition[] = [homeScene, boardScene]): MockScenes {
  const mock = createMockScenes();

  mock.flow.features.push({ name: "board", description: { scenes: [...scenes] } });
  mock.start();

  return mock;
}

describe("the switch on an over node", () => {
  it("returns without touching the world and warns when the node names a scene", async () => {
    const mock = startedMock();

    await mock.enter({ path: "main/popup", over: true, scene: "board" });

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledWith("scenes: an over node cannot name a scene", {
      path: "main/popup"
    });
  });

  it("is silent for an over node that names no scene", async () => {
    const mock = startedMock();

    await mock.enter({ path: "main/popup", over: true });

    expect(mock.world.calls).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});

describe("the switch in fast mode", () => {
  it("only records the scene of a transit node", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" }, { mode: "fast" });

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.pending).toBe("board");
    expect(mock.state.current).toBeUndefined();
  });

  it("keeps the recorded scene when a later transit node names none", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" }, { mode: "fast" });
    await mock.enter({}, { mode: "fast" });

    expect(mock.state.pending).toBe("board");
  });

  it("switches once at the rest node and clears what it recorded", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" }, { mode: "fast" });
    await mock.enter({ scene: "board" }, { mode: "fast" });
    await mock.enter({ rest: true }, { mode: "fast" });

    expect(mock.world.mounted).toHaveLength(1);
    expect(mock.state.current).toBe("board");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: undefined, to: "board", music: undefined } }
    ]);
  });

  it("mounts the scene a transit node recorded at an over rest node, over another mounted scene", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.emitted.length = 0;
    await mock.enter({ scene: "board" }, { mode: "fast" });
    await mock.enter({ path: "main/popup", rest: true, over: true }, { mode: "fast" });

    expect(mock.state.current).toBe("board");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: "home", to: "board", music: undefined } }
    ]);
  });

  it("lets the rest node's own scene win over the recorded one", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" }, { mode: "fast" });
    await mock.enter({ rest: true, scene: "home" }, { mode: "fast" });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
  });
});

describe("the switch when nothing has to happen", () => {
  it("keeps the current scene for a node that names none", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" });
    mock.world.calls.length = 0;

    await mock.enter({ rest: true });

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBe("board");
  });

  it("warns when the first rest node of a game names no scene", async () => {
    const mock = startedMock();

    await mock.enter({ path: "main/home", rest: true });

    expect(mock.log.warn).toHaveBeenCalledWith("scenes: a rest node was entered with no scene", {
      path: "main/home"
    });
  });

  it("is silent for a transit node that names no scene", async () => {
    const mock = startedMock();

    await mock.enter({ path: "main/boot" });

    expect(mock.log.warn).not.toHaveBeenCalled();
    expect(mock.world.calls).toEqual([]);
  });

  it("does nothing when the node names the scene that is already mounted", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;

    await mock.enter({ scene: "board" });

    expect(mock.world.calls).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });
});

describe("the switch on an unknown scene", () => {
  it("throws and names the scene, so flow rolls the node back", async () => {
    const mock = startedMock();

    await expect(mock.enter({ scene: "bord" })).rejects.toThrow(
      '[game] Scene "bord" is not registered.\n  List it in the scenes of a feature.'
    );
    expect(mock.state.current).toBeUndefined();
  });
});

describe("the switch around the bundle load", () => {
  it("loads the bundle of the scene before it touches the world", async () => {
    const mock = startedMock();

    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "board" });

    await Promise.resolve();

    expect(mock.assets.loaded).toEqual(["board"]);
    expect(mock.world.calls).toEqual([]);

    mock.assets.release();
    await entering;

    expect(mock.world.calls).toEqual(["setLayers", "mount"]);
  });

  it("returns and touches nothing when the node was aborted during the load", async () => {
    const mock = startedMock();
    const controller = new AbortController();

    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "board" }, { signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    await entering;

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBeUndefined();
    expect(mock.emitted).toEqual([]);
  });

  it("returns at once when the signal was already aborted", async () => {
    const mock = startedMock();
    const controller = new AbortController();

    controller.abort();
    await mock.enter({ scene: "board" }, { signal: controller.signal });

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBeUndefined();
  });

  it("rejects when the load fails, and keeps the scene that is mounted", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "board" });

    await Promise.resolve();
    mock.assets.fail(new Error("404"));

    await expect(entering).rejects.toThrow("404");
    expect(mock.state.current).toBe("home");
  });

  it("logs a load that fails after the abort instead of throwing it", async () => {
    const mock = startedMock();
    const controller = new AbortController();

    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "board" }, { signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    await entering;

    mock.assets.fail(new Error("too late"));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "scenes: a cancelled bundle load failed",
      expect.objectContaining({ bundle: "board" })
    );
  });
});

describe("the synchronous block of the switch", () => {
  it("sets the layers, unmounts the old projections, mounts the new ones and then emits", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    await mock.enter({ scene: "board" });

    expect(mock.world.calls).toEqual(["setLayers", "mount", "setLayers", "unmount", "mount"]);
    expect(mock.world.layers[1]).toEqual([
      { name: "cells", sort: "none" },
      { name: "items", sort: "y" },
      { name: "lifted", sort: "none" },
      { name: "ui", sort: "order" }
    ]);
    expect(mock.world.unmounted[0]).toEqual([]);
    expect(mock.world.mounted[1]).toEqual({
      names: ["board.cells", "board.items"],
      owner: { kind: "plugin", name: "scenes" }
    });
    expect(mock.state.current).toBe("board");
    expect(mock.emitted[1]).toEqual({
      name: "scenes:changed",
      payload: { from: "home", to: "board", music: undefined }
    });
  });

  it("carries the music key of the new scene in the event", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });

    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: undefined, to: "home", music: "home.theme" } }
    ]);
  });

  it("wakes the frame loop, so the new scene is drawn at the full frame rate", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });

    expect(mock.time.wakes).toBe(1);

    await mock.enter({ scene: "board" });

    expect(mock.time.wakes).toBe(2);
  });

  it("does not wake the loop when no scene changed", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "board" });
    await mock.enter({ scene: "board" });
    await mock.enter({ rest: true });
    await mock.enter({ path: "main/popup", over: true });

    expect(mock.time.wakes).toBe(1);
  });

  it("lets a failing mount reject, so flow rolls the node back", async () => {
    const mock = startedMock();

    mock.world.mountError = new Error("[game] Projection is not registered.");

    await expect(mock.enter({ scene: "board" })).rejects.toThrow("[game] Projection");
    expect(mock.state.current).toBeUndefined();
    expect(mock.emitted).toEqual([]);
  });
});

describe("the switch after the restore door expected a scene", () => {
  it("mounts the expected scene at a rest node that names none", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "main/home", rest: true });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual(["setLayers", "mount"]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("mounts the expected scene under an over rest node when nothing is mounted", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "settings/open", rest: true, over: true });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: undefined, to: "home", music: "home.theme" } }
    ]);
  });

  it("switches to the expected scene under an over rest node while another scene is mounted", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    mock.api.expect("board");
    await mock.enter({ path: "settings/open", rest: true, over: true });

    expect(mock.state.current).toBe("board");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual(["setLayers", "unmount", "mount"]);
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: "home", to: "board", music: undefined } }
    ]);
  });

  it("clears the record and touches nothing at an over node when the mounted scene is expected", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    mock.api.expect("home");
    await mock.enter({ path: "settings/open", rest: true, over: true });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });

  it("does nothing at an over node with a scene mounted and nothing expected", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    await mock.enter({ path: "settings/open", rest: true, over: true });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("does nothing for an over rest node with nothing mounted and nothing expected", async () => {
    const mock = startedMock();

    await mock.enter({ path: "settings/open", rest: true, over: true });

    expect(mock.state.current).toBeUndefined();
    expect(mock.world.calls).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });
});

describe("the switch at a transit node after the restore door expected a scene", () => {
  it("mounts the expected scene at a transit node in live mode that names none", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "info/show" });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual(["setLayers", "mount"]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("mounts the transit node's own scene in live mode and keeps the expected one", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "main/play", scene: "board" });

    expect(mock.state.current).toBe("board");
    expect(mock.state.pending).toBe("home");
    expect(mock.world.mounted).toHaveLength(1);
  });

  it("mounts the expected scene under an over transit node when nothing is mounted", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "info/show", over: true });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: undefined, to: "home", music: "home.theme" } }
    ]);
  });

  it("switches to the expected scene under an over transit node while another scene is mounted", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    mock.api.expect("board");
    await mock.enter({ path: "info/show", over: true });

    expect(mock.state.current).toBe("board");
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual(["setLayers", "unmount", "mount"]);
    expect(mock.emitted).toEqual([
      { name: "scenes:changed", payload: { from: "home", to: "board", music: undefined } }
    ]);
  });

  it("does nothing at a transit node in live mode with nothing expected", async () => {
    const mock = startedMock();

    await mock.enter({ path: "info/show" });

    expect(mock.state.current).toBeUndefined();
    expect(mock.state.pending).toBeUndefined();
    expect(mock.world.calls).toEqual([]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("leaves the expected scene for the rest point at a transit node in fast mode", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "info/show" }, { mode: "fast" });

    expect(mock.state.current).toBeUndefined();
    expect(mock.state.pending).toBe("home");
    expect(mock.world.calls).toEqual([]);
  });

  it("leaves the expected scene alone at an over transit node in fast mode", async () => {
    const mock = startedMock();

    mock.api.expect("home");
    await mock.enter({ path: "info/show", over: true }, { mode: "fast" });

    expect(mock.state.current).toBeUndefined();
    expect(mock.state.pending).toBe("home");
    expect(mock.world.calls).toEqual([]);
  });

  it("leaves the expected scene alone at an over transit node in fast mode while another scene is mounted", async () => {
    const mock = startedMock();

    await mock.enter({ scene: "home" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    mock.api.expect("board");
    await mock.enter({ path: "info/show", over: true }, { mode: "fast" });

    expect(mock.state.current).toBe("home");
    expect(mock.state.pending).toBe("board");
    expect(mock.world.calls).toEqual([]);
    expect(mock.emitted).toEqual([]);
  });
});

/** Every state the ward's `bundles` was called with, in order. */
const wardSeen: SceneState[] = [];

const wardScene = defineScene("ward", {
  bundle: "location",
  bundles: (state: SceneState<Json, { episode: string }>) => {
    wardSeen.push(state);

    return [state.session.episode];
  },
  layers: { room: {} },
  projections: [{ name: "ward.room", layer: "room" }]
});

const brokenScene = defineScene("broken", {
  bundle: "location",
  bundles: () => {
    throw new Error("no episode in the session");
  },
  layers: {},
  projections: []
});

/**
 * Starts the plugin with home, board, ward and broken registered, the session at `ep01`.
 *
 * @returns The started mock.
 */
function wardMock(): MockScenes {
  const mock = startedMock([homeScene, boardScene, wardScene, brokenScene]);

  wardSeen.length = 0;
  mock.model.set({}, { episode: "ep01" });

  return mock;
}

/**
 * Gives the pending promise callbacks of the switch their turns.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe("the switch to a scene with bundles of state", () => {
  // Bug: the world is touched while the episode is still loading, or the loads run one by one.
  it("loads the scene bundle and every bundle bundles names before it touches the world", async () => {
    const mock = wardMock();

    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "ward" });

    await flush();

    expect(mock.assets.loaded).toEqual(["location", "ep01"]);

    mock.assets.releaseBundle("location");
    await flush();

    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBeUndefined();

    mock.assets.releaseBundle("ep01");
    await entering;

    expect(mock.world.calls).toEqual(["setLayers", "mount"]);
    expect(mock.state.current).toBe("ward");
    expect(mock.state.named).toEqual(["location", "ep01"]);
  });

  // Bug: `bundles` reads a draft or a mutable copy instead of the committed trees.
  it("calls bundles with the committed player and session, frozen", async () => {
    const mock = wardMock();
    const committed = mock.model.api.store.snapshot();

    await mock.enter({ scene: "ward" });

    expect(wardSeen).toHaveLength(1);
    expect(wardSeen[0]).toEqual({ player: committed.player, session: committed.session });
    expect(wardSeen[0]?.session).toBe(committed.session);
    expect(Object.isFrozen(wardSeen[0])).toBe(true);
  });

  // Bug: the ward is mounted over a missing episode.
  it("rejects and keeps the mounted scene when one named bundle fails", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "home" });
    mock.assets.control.gated = true;

    const entering = mock.enter({ scene: "ward" });

    await flush();
    mock.assets.releaseBundle("location");
    mock.assets.fail(new Error("ep01: 404"));

    await expect(entering).rejects.toThrow("ep01: 404");
    expect(mock.state.current).toBe("home");
    expect(mock.state.named).toEqual(["home"]);
  });

  // Bug: loads start before `bundles` ran, or the switch is half done when it throws.
  it("rejects without loading or touching the world when bundles throws", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "home" });
    mock.assets.loaded.length = 0;
    mock.world.calls.length = 0;

    await expect(mock.enter({ scene: "broken" })).rejects.toThrow("no episode in the session");
    expect(mock.assets.loaded).toEqual([]);
    expect(mock.world.calls).toEqual([]);
    expect(mock.state.current).toBe("home");
  });
});

describe("the re-read at a node of the mounted scene", () => {
  // Bug: the episode the state names now is never loaded, or the scene is mounted again for it.
  it("re-reads bundles at a node of the mounted scene and awaits the newly named bundle without mounting again", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "ward" });
    mock.world.calls.length = 0;
    mock.emitted.length = 0;
    mock.model.set({}, { episode: "ep02" });
    mock.assets.control.gated = true;

    const settled = { done: false };
    const entering = mock.enter({ scene: "ward", rest: true }).then(() => {
      settled.done = true;
    });

    await flush();

    expect(mock.assets.loaded).toContain("ep02");
    expect(settled.done).toBe(false);

    mock.assets.release();
    await entering;

    expect(mock.state.named).toEqual(["location", "ep02"]);
    expect(mock.world.calls).toEqual([]);
    expect(mock.emitted).toEqual([]);
    expect(mock.time.wakes).toBe(1);
  });

  // Bug: every node entry starts a load, and an in-flight load delays every node.
  it("loads nothing at a node of the mounted scene when bundles names the same list", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "ward" });
    mock.assets.loaded.length = 0;

    await mock.enter({ rest: true });
    await mock.enter({ scene: "ward" });
    await mock.enter({ path: "main/popup", over: true });

    expect(mock.assets.loaded).toEqual([]);

    // A scene without bundles never re-reads: a flat game makes exactly the calls of today.
    await mock.enter({ scene: "board" });
    mock.assets.loaded.length = 0;
    await mock.enter({ rest: true });

    expect(mock.assets.loaded).toEqual([]);
  });

  // Bug: a fast walk loads the bundles of every transit node it passes.
  it("does not re-read bundles at a transit node of a fast walk", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "ward" });
    mock.assets.loaded.length = 0;
    wardSeen.length = 0;
    mock.model.set({}, { episode: "ep02" });

    await mock.enter({ path: "main/walk" }, { mode: "fast" });
    await mock.enter({ path: "main/popup", over: true }, { mode: "fast" });

    expect(wardSeen).toEqual([]);
    expect(mock.assets.loaded).toEqual([]);
    expect(mock.state.named).toEqual(["location", "ep01"]);
  });

  // Bug: assets never learns what the mounted scene names, or is told on every node.
  it("tells assets what the mounted scene names after a switch and after a re-read that changed it, and not after one that did not", async () => {
    const mock = wardMock();

    await mock.enter({ scene: "ward" });
    await mock.enter({ rest: true });
    mock.model.set({}, { episode: "ep02" });
    await mock.enter({ rest: true });
    await mock.enter({ rest: true });

    expect(mock.assets.named).toEqual([
      ["location", "ep01"],
      ["location", "ep02"]
    ]);
  });

  // Bug: `named` lists bundles that never arrived, so the next node skips their load.
  it("keeps the named list when the node is aborted during the re-read", async () => {
    const mock = wardMock();
    const controller = new AbortController();

    await mock.enter({ scene: "ward" });
    mock.model.set({}, { episode: "ep02" });
    mock.assets.control.gated = true;

    const entering = mock.enter({ rest: true }, { signal: controller.signal });

    await flush();
    controller.abort();
    await entering;

    expect(mock.state.named).toEqual(["location", "ep01"]);
    expect(mock.assets.named).toEqual([["location", "ep01"]]);
  });
});

describe("a switch in the performance log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the scenes it switched between in an agent build, and nowhere without the flag", async () => {
    const plain = startedMock();

    await plain.enter({ scene: "home" });

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const agent = startedMock();

    await agent.enter({ scene: "home" });
    await agent.enter({ scene: "board" });

    expect(plain.renderer.monitor.event).not.toHaveBeenCalled();
    expect(agent.renderer.monitor.event.mock.calls).toEqual([
      // eslint-disable-next-line unicorn/no-null -- the log is JSON: no scene before is null.
      ["scene", { from: null, to: "home" }],
      ["scene", { from: "home", to: "board" }]
    ]);
  });
});

describe("the scene the world's systems run on", () => {
  const wardScene = defineScene("ward", { bundle: "ward", layers: { scene: {} }, projections: [] });

  /**
   * Starts the plugin with the ward and the board declared.
   *
   * @returns The started mock.
   */
  function twoScenes(): MockScenes {
    const mock = createMockScenes();

    mock.flow.features.push(
      { name: "screens", description: { scenes: [wardScene] } },
      { name: "boardScreens", description: { scenes: [boardScene] } }
    );
    mock.start();

    return mock;
  }

  // Bug caught: the world is never told, or told the scene before, so a system with
  // scenes: ["board"] sleeps on the board or runs on the ward.
  it("every switch tells the world the scene it mounted", async () => {
    const mock = twoScenes();

    await mock.enter({ rest: true, scene: "ward" });
    await mock.enter({ rest: true, scene: "board" });
    await mock.enter({ rest: true, scene: "board" });

    expect(mock.world.scenes).toEqual(["ward", "board"]);
  });

  // Bug caught: the world is told before the switch stands, so after a failed mount, a failed load
  // or an abort the systems of a scene that never came run while the old scene is still drawn.
  it("a switch that does not stand tells the world nothing", async () => {
    const mock = twoScenes();

    await mock.enter({ rest: true, scene: "ward" });

    mock.world.mountError = new Error("unknown projection");
    await expect(mock.enter({ rest: true, scene: "board" })).rejects.toThrow("unknown projection");

    mock.assets.control.gated = true;

    const controller = new AbortController();
    const aborted = mock.enter({ rest: true, scene: "board" }, { signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    await aborted;

    const failed = mock.enter({ rest: true, scene: "board" });

    await Promise.resolve();
    mock.assets.fail(new Error("offline"));
    await expect(failed).rejects.toThrow("offline");

    expect(mock.world.scenes).toEqual(["ward"]);
  });
});

describe("a projection both scenes list", () => {
  const shared = { name: "shared.hud", layer: "ui" } as const;
  const wardScene = defineScene("ward", {
    bundle: "ward",
    layers: { scene: {} },
    projections: [{ name: "ward.room", layer: "scene" }, shared]
  });
  const shopScene = defineScene("shop", {
    bundle: "shop",
    layers: {},
    projections: [shared, { name: "shop.shelf", layer: "ui" }]
  });

  // Bug caught (F23): the switch unmounts every projection of the leaving scene, so the shared
  // HUD is torn down and built again, and its labels blink for a frame.
  it("unmounts only what the new scene does not list, and mounts the new scene's whole list", async () => {
    const mock = startedMock([wardScene, shopScene]);

    await mock.enter({ rest: true, scene: "ward" });
    await mock.enter({ rest: true, scene: "shop" });

    expect(mock.world.unmounted).toEqual([["ward.room"]]);
    expect(mock.world.mounted[1]).toEqual({
      names: ["shared.hud", "shop.shelf"],
      owner: { kind: "plugin", name: "scenes" }
    });
  });
});
