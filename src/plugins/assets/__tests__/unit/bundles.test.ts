import { describe, expect, it } from "vitest";
import { defineBundles, load } from "../../bundles";
import type { BundleSpec } from "../../types";

describe("defineBundles", () => {
  it("returns plain data tagged as a bundle map", () => {
    const bundles = defineBundles({
      board: { tier: "scene" },
      "board.chains": { tier: "lazy", files: ["chains/*.png"] }
    });

    expect(bundles).toEqual({
      kind: "bundles",
      map: {
        board: { tier: "scene" },
        "board.chains": { tier: "lazy", files: ["chains/*.png"] }
      }
    });
  });

  it("copies the map, so a later change of the caller's object cannot reach it", () => {
    const map: Record<string, BundleSpec> = { board: { tier: "scene" } };
    const bundles = defineBundles(map);

    map.board = { tier: "lazy" };

    expect(bundles.map.board).toEqual({ tier: "scene" });
  });

  it("accepts an empty map", () => {
    expect(defineBundles({})).toEqual({ kind: "bundles", map: {} });
  });
});

describe("load", () => {
  it("makes the descriptor of one bundle", () => {
    expect(load("board.chains")).toEqual({
      kind: "load",
      payload: { bundles: ["board.chains"] }
    });
  });

  it("makes the descriptor of several bundles", () => {
    expect(load(["board", "ui"])).toEqual({ kind: "load", payload: { bundles: ["board", "ui"] } });
  });

  it("copies the list, so the descriptor stays plain JSON", () => {
    const wanted = ["board"];
    const descriptor = load(wanted);

    wanted.push("ui");

    expect(descriptor.payload).toEqual({ bundles: ["board"] });
  });
});
