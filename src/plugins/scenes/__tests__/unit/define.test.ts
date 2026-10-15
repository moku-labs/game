import { describe, expect, it } from "vitest";
import type { Json } from "../../../model/types";
import { projection } from "../../../world/projection/define";
import { defineScene } from "../../define";
import type { SceneState } from "../../types";

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

const hudPanel = projection({
  name: "hud.panel",
  layer: "ui",
  from: (player: { items: Item[] }) => player.items,
  key: (item: Item) => item.id,
  view: () => []
});

const boardToast = projection({
  name: "board.toast",
  layer: "cells",
  lift: "ui",
  from: (player: { cells: Item[] }) => player.cells,
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
      { name: "lifted", sort: "none" },
      { name: "ui", sort: "order" }
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

    expect(scene.layers.map(layer => layer.name)).toEqual(["01", "-1", "1.5", "ui"]);
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

describe("defineScene and the ui layer", () => {
  it("appends ui on top of the layers the scene declared", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {}, items: { sort: "y" } },
      projections: []
    });

    expect(scene.layers).toEqual([
      { name: "cells", sort: "none" },
      { name: "items", sort: "y" },
      { name: "ui", sort: "order" }
    ]);
  });

  it("appends it to a scene that declares no layer at all", () => {
    const scene = defineScene("boot", { bundle: "boot", layers: {}, projections: [] });

    expect(scene.layers).toEqual([{ name: "ui", sort: "order" }]);
  });

  // Bug (C1, U1.7): the roots of a scene draw in mount order, so a root remounted by a commit covers the others.
  it("appends it once and not twice when the scene declares ui itself, sorted by order", () => {
    const scene = defineScene("home", { bundle: "home", layers: { ui: {} }, projections: [] });

    expect(scene.layers).toEqual([{ name: "ui", sort: "order" }]);
  });

  it("keeps insertion order for a ui layer the scene declares with sort none", () => {
    const scene = defineScene("home", {
      bundle: "home",
      layers: { ui: { sort: "none" }, fx: {} },
      projections: []
    });

    expect(scene.layers).toEqual([
      { name: "ui", sort: "none" },
      { name: "fx", sort: "none" }
    ]);
  });

  it("leaves a declared ui where it was written, under the layers above it", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {}, ui: {}, fx: {} },
      projections: []
    });

    expect(scene.layers.map(layer => layer.name)).toEqual(["cells", "ui", "fx"]);
  });

  it("keeps the sort rule of a ui layer the scene declared", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { ui: { sort: "order" } },
      projections: []
    });

    expect(scene.layers).toEqual([{ name: "ui", sort: "order" }]);
  });

  it("freezes the appended layer like the declared ones", () => {
    const scene = defineScene("board", { bundle: "board", layers: { cells: {} }, projections: [] });

    expect(Object.isFrozen(scene.layers[1])).toBe(true);
  });

  it("accepts a projection that names the appended ui layer", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {} },
      projections: [boardCells, hudPanel]
    });

    expect(scene.projections).toEqual(["board.cells", "hud.panel"]);
  });

  it("accepts a projection lifted onto the appended ui layer", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {} },
      projections: [boardToast]
    });

    expect(scene.projections).toEqual(["board.toast"]);
  });

  it("still rejects a projection whose layer is neither declared nor ui", () => {
    expect(() =>
      defineScene("board", {
        bundle: "board",
        layers: { cells: {} },
        // @ts-expect-error — "items" is neither declared nor the appended ui layer.
        projections: [boardItems]
      })
    ).toThrow('[game] Scene "board": projection "board.items" names layer "items".');
  });
});

describe("defineScene and the HUD layer", () => {
  it("puts ui right under the HUD layer when the scene declares no ui", () => {
    const scene = defineScene("ward", {
      bundle: "ward",
      layers: { scene: {}, hud: { above: "overlays" } },
      projections: []
    });

    expect(scene.layers).toEqual([
      { name: "scene", sort: "none" },
      { name: "ui", sort: "order" },
      { name: "hud", sort: "none", above: "overlays" }
    ]);
  });

  it("gives a scene without above the same entries as before, with no above key at all", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {}, items: { sort: "y" } },
      projections: []
    });

    expect(JSON.stringify(scene.layers)).toBe(
      '[{"name":"cells","sort":"none"},{"name":"items","sort":"y"},{"name":"ui","sort":"order"}]'
    );
  });

  it("keeps a layer declared after the HUD layer above it", () => {
    const scene = defineScene("board", {
      bundle: "board",
      layers: { cells: {}, ui: { sort: "order" }, hud: { above: "overlays" }, lifted: {} },
      projections: []
    });

    expect(scene.layers.map(layer => layer.name)).toEqual(["cells", "ui", "hud", "lifted"]);
  });

  it("throws for two HUD layers", () => {
    expect(() =>
      defineScene("ward", {
        bundle: "ward",
        layers: { hud: { above: "overlays" }, top: { above: "overlays" } },
        projections: []
      })
    ).toThrow(
      '[game] Scene "ward": two layers say above "overlays" ("hud", "top").\n  Keep one HUD layer.'
    );
  });

  it("throws for a ui declared after the HUD layer", () => {
    expect(() =>
      defineScene("ward", {
        bundle: "ward",
        layers: { hud: { above: "overlays" }, ui: {} },
        projections: []
      })
    ).toThrow(
      '[game] Scene "ward": the layer "ui" comes after the HUD layer "hud".\n  Declare ui before it: popups are overlays and draw under the HUD.'
    );
  });

  it("throws for above with another value, for a caller without types", () => {
    const layers = { hud: { above: "ui" } } as unknown as Record<string, { above?: "overlays" }>;

    expect(() => defineScene("ward", { bundle: "ward", layers, projections: [] })).toThrow(
      '[game] Scene "ward": the layer "hud" has above "ui".\n  Use "overlays" or leave it out.'
    );
  });
});

/**
 * The ward's bundles of state: the episode the session plays.
 *
 * @param state - The committed state.
 * @param state.session - The session, whose episode names the bundle.
 * @returns The episode bundle.
 */
const wardBundles = ({ session }: SceneState<Json, { episode: string }>): string[] => [
  session.episode
];

describe("defineScene and the bundles of state", () => {
  // Bug: the freeze drops the function, so the switch never awaits the episode.
  it("keeps the bundles function the scene declared", () => {
    const scene = defineScene("ward", {
      bundle: "location",
      bundles: wardBundles,
      layers: { room: {} },
      projections: []
    });

    expect(scene.bundles).toBe(wardBundles);
    expect(scene.bundles?.({ player: {}, session: { episode: "ep02" } })).toEqual(["ep02"]);
  });

  // Bug: a flat game's scene objects change shape.
  it("has no bundles key for a scene that declares none", () => {
    const scene = defineScene("home", { bundle: "home", layers: { ui: {} }, projections: [] });

    expect(Object.keys(scene)).toEqual(["id", "bundle", "music", "layers", "projections"]);
  });
});
