import { describe, expect, it } from "vitest";
import { projection } from "../../../world/projection/define";
import { defineScene } from "../../define";

type Item = { id: string };

const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: (player: { cells: Item[] }) => player.cells,
  key: (item: Item) => item.id,
  view: () => []
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: (player: { items: Item[] }) => player.items,
  key: (item: Item) => item.id,
  view: () => []
});

describe("defineScene", () => {
  it("keeps the layers in the order they were written and defaults sort to none", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { background: {}, cells: {}, items: { sort: "y" }, lifted: {} },
      projections: [boardCells, boardItems]
    });

    expect(scene.layers).toEqual([
      { name: "background", sort: "none" },
      { name: "cells", sort: "none" },
      { name: "items", sort: "y" },
      { name: "lifted", sort: "none" }
    ]);
  });

  it("returns the id, the bundle, the projection names and no music", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {}, items: {}, lifted: {} },
      projections: [boardCells, boardItems]
    });

    expect(scene.id).toBe("board");
    expect(scene.bundle).toBe("board");
    expect(scene.projections).toEqual(["board.cells", "board.items"]);
    expect(scene.music).toBeUndefined();
  });

  it("keeps the music key when the scene declares one", () => {
    const scene = defineScene("home", {
      bundle: "home",
      layers: { ui: {} },
      projections: [],
      music: "home.theme"
    });

    expect(scene.music).toBe("home.theme");
  });

  it("returns frozen data, so a feature cannot edit a scene after it was declared", () => {
    const scene = defineScene("home", { bundle: "home", layers: { ui: {} }, projections: [] });

    expect(Object.isFrozen(scene)).toBe(true);
    expect(Object.isFrozen(scene.layers)).toBe(true);
    expect(Object.isFrozen(scene.projections)).toBe(true);
    expect(Object.isFrozen(scene.layers[0])).toBe(true);
  });

  it("throws for a projection whose layer is not declared", () => {
    expect(() =>
      defineScene("board", {
        bundle: "board",
        layers: { cells: {} },
        // @ts-expect-error — "items" is not a layer of this scene.
        projections: [boardItems]
      })
    ).toThrow(
      '[game] Scene "board": projection "board.items" names layer "items".\n' +
        "  Declare it in layers or fix the name."
    );
  });

  it("throws for a projection whose lift layer is not declared", () => {
    expect(() =>
      defineScene("board", {
        bundle: "board",
        layers: { cells: {}, items: {} },
        // @ts-expect-error — "lifted" is not a layer of this scene.
        projections: [boardItems]
      })
    ).toThrow(
      '[game] Scene "board": projection "board.items" names lift layer "lifted".\n' +
        "  Declare it in layers or fix the name."
    );
  });

  it("accepts a projection that declares no lift", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {} },
      projections: [boardCells]
    });

    expect(scene.projections).toEqual(["board.cells"]);
  });

  it("throws for an integer-like layer name, which JavaScript would reorder", () => {
    expect(() =>
      defineScene("board", { bundle: "board", layers: { items: {}, "1": {} }, projections: [] })
    ).toThrow(
      '[game] Scene "board": the layer name "1" is an integer.\n' +
        "  Rename it: JavaScript orders integer keys first, so the draw order would not be yours."
    );
  });

  it("accepts a name that only looks numeric, because JavaScript keeps its place", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { "01": {}, "-1": {}, "1.5": {} },
      projections: []
    });

    expect(scene.layers.map(layer => layer.name)).toEqual(["01", "-1", "1.5"]);
  });

  it("throws for the layer name 0, the first integer key", () => {
    expect(() =>
      defineScene("board", { bundle: "board", layers: { "0": {} }, projections: [] })
    ).toThrow('[game] Scene "board": the layer name "0" is an integer.');
  });

  it("copies the projection list, so a later push cannot reach the scene", () => {
    const list = [boardCells];
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {} },
      projections: list
    });

    list.push(boardCells);

    expect(scene.projections).toEqual(["board.cells"]);
  });
});
