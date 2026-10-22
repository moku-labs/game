import { describe, expect, it } from "vitest";
import { defineBundles, load, ready } from "../../bundles";
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

  it("copies release and mipmaps, detached from the caller's globs", () => {
    const globs = ["items/**"];
    const bundles = defineBundles({
      ep01: { tier: "lazy", release: "leave", mipmaps: globs },
      "ep01.all": { tier: "lazy", mipmaps: true }
    });

    globs.push("ward/**");

    expect(bundles.map).toEqual({
      ep01: { tier: "lazy", release: "leave", mipmaps: ["items/**"] },
      "ep01.all": { tier: "lazy", mipmaps: true }
    });
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

describe("defineBundles edge cases", () => {
  it("drops a name whose spec is undefined", () => {
    const map = Object.fromEntries([
      ["board", { tier: "scene" }],
      ["ui", undefined]
    ]) as Partial<Record<"board" | "ui", BundleSpec>>;

    expect(defineBundles(map)).toEqual({ kind: "bundles", map: { board: { tier: "scene" } } });
  });
});

describe("load edge cases", () => {
  it("accepts an empty list", () => {
    expect(load([])).toEqual({ kind: "load", payload: { bundles: [] } });
  });
});

describe("ready", () => {
  // Bug: a single name is not wrapped in a list, so the handler reads no bundle and answers true at once.
  it("makes the descriptor of one bundle, a list of one", () => {
    expect(ready("ep01.memory")).toEqual({
      kind: "ready",
      payload: { bundles: ["ep01.memory"] }
    });
  });

  // Bug: the descriptor holds the caller's array, so a later push changes what a journal replays.
  it("copies a list of bundles", () => {
    const wanted = ["ep01.memory"];
    const descriptor = ready(wanted);

    wanted.push("ui");

    expect(descriptor).toEqual({ kind: "ready", payload: { bundles: ["ep01.memory"] } });
  });
});
