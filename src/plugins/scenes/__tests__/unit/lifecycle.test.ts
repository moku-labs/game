import { describe, expect, it } from "vitest";
import { defineScene } from "../../define";
import { createMockScenes } from "./mock-scenes";

const homeScene = defineScene("home", { bundle: "home", layers: { ui: {} }, projections: [] });
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {}, items: { sort: "y" } },
  projections: [{ name: "board.cells", layer: "cells" }]
});

describe("startScenes", () => {
  it("collects the scenes of every feature that brought some", () => {
    const mock = createMockScenes();

    mock.flow.features.push(
      { name: "menu", description: { scenes: [homeScene] } },
      { name: "board", description: { scenes: [boardScene], flows: [] } }
    );
    mock.start();

    expect([...mock.state.scenes.keys()]).toEqual(["home", "board"]);
    expect(mock.state.scenes.get("board")?.bundle).toBe("board");
  });

  it("ignores a feature with no scenes key and a scenes key that is not a list", () => {
    const mock = createMockScenes();

    mock.flow.features.push(
      { name: "logic", description: { flows: [] } },
      { name: "broken", description: { scenes: "home" } }
    );
    mock.start();

    expect(mock.state.scenes.size).toBe(0);
  });

  it("ignores an entry of the list that is not a scene declaration", () => {
    const mock = createMockScenes();

    mock.flow.features.push({
      name: "menu",
      description: { scenes: ["home", undefined, { id: "half" }, homeScene] }
    });
    mock.start();

    expect([...mock.state.scenes.keys()]).toEqual(["home"]);
  });

  it("throws for a duplicate scene id and names both features", () => {
    const mock = createMockScenes();

    mock.flow.features.push(
      { name: "menu", description: { scenes: [homeScene] } },
      { name: "shop", description: { scenes: [homeScene] } }
    );

    expect(() => mock.start()).toThrow(
      '[game] Scene "home" is declared by the features "menu" and "shop".\n' +
        "  Give one of the two scenes another id."
    );
  });

  it("registers one callback on the scene stage and keeps its remover", () => {
    const mock = createMockScenes();

    mock.start();

    expect(mock.flow.enter).toHaveLength(1);
    expect(mock.flow.enter[0]?.stage).toBe("scene");
    expect(mock.state.teardown).toBeInstanceOf(Function);
  });
});

describe("checkConfig", () => {
  // Bug: a budget of 0, NaN or a string never counts down: every frame of a build makes one view and the switch
  // takes seconds. A game written in plain JS passes anything; `onInit` refuses it, so `createApp` throws. A string
  // other than "auto" is refused too: the check must not let every string through.
  it.each([
    [Number.NaN, "NaN"],
    [0, "0"],
    ["4", "4"],
    ["fast", "fast"]
  ])("refuses a buildMs of %s, named in the message", (buildMs, shown) => {
    const mock = createMockScenes({ buildMs } as unknown as { buildMs: number });

    expect(() => mock.init()).toThrow(
      `[game] scenes.buildMs is ${shown}.\n` +
        '  Give "auto" or the milliseconds a frame may spend on the next scene, a finite number above 0 such as 4.'
    );
  });

  it("lets a finite budget above 0 through", () => {
    expect(() => createMockScenes({ buildMs: 0.5 }).init()).not.toThrow();
  });

  // Bug: the default is refused, so every app that leaves `buildMs` out throws at `createApp`.
  it('lets "auto" through', () => {
    expect(() => createMockScenes({ buildMs: "auto" }).init()).not.toThrow();
  });
});

describe("stopScenes", () => {
  it("removes the callback and empties the registry", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    await mock.enter({ scene: "home", rest: true });
    mock.stop();

    expect(mock.flow.enter).toEqual([]);
    expect(mock.state.teardown).toBeUndefined();
    expect(mock.state.scenes.size).toBe(0);
    expect(mock.state.current).toBeUndefined();
    expect(mock.state.pending).toBeUndefined();
  });

  it("unmounts nothing: the world clears its own entities when it stops", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    await mock.enter({ scene: "home", rest: true });
    mock.world.calls.length = 0;
    mock.stop();

    expect(mock.world.calls).toEqual([]);
  });

  // Bug: a stale list survives a restart of the app.
  it("forgets the named list", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    await mock.enter({ scene: "home", rest: true });

    expect(mock.state.named).toEqual(["home"]);

    mock.stop();

    expect(mock.state.named).toEqual([]);
  });

  it("is safe when the plugin never started", () => {
    const mock = createMockScenes();

    expect(() => mock.stop()).not.toThrow();
  });
});
