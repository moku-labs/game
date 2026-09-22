import { describe, expect, it } from "vitest";
import { defineScene } from "../../define";
import type { SceneDefinition } from "../../types";
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
      { name: "ui", sort: "none" }
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
