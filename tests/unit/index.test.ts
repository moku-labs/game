import * as engine from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { defineFlow, defineNode } from "../../src/plugins/flow/runner/define";

describe("root index", () => {
  it("exports no teardown registry: a plugin frees its resource in onStop from its state", () => {
    expect(Object.keys(engine)).not.toContain("teardown");
  });

  it("resolves the package name to the source", () => {
    expect(engine.createApp).toBeTypeOf("function");
    expect(engine.createPlugin).toBeTypeOf("function");
  });

  it("defineGame returns the same functions the plugins export", () => {
    const kit = engine.defineGame();

    expect(kit.defineNode).toBe(defineNode);
    expect(kit.defineFlow).toBe(defineFlow);
    expect(kit.defineFeature).toBe(engine.defineFeature);
    expect(kit.projection).toBe(engine.projection);
    expect(kit.sprite).toBe(engine.sprite);
    expect(kit.defineBundles).toBe(engine.defineBundles);
    expect(kit.load).toBe(engine.load);
    expect(kit.defineScene).toBe(engine.defineScene);
    expect(kit.Sprite).toBe(engine.Sprite);
    expect(kit.NineSlice).toBe(engine.NineSlice);
    expect(kit.defineAnimation).toBe(engine.defineAnimation);
    expect(kit.frames).toBe(engine.frames);
    expect(kit.sfx).toBe(engine.sfx);
    expect(kit.play).toBe(engine.play);
    expect(kit.tr).toBe(engine.tr);
    expect(kit.music).toBe(engine.music);
    expect(Object.keys(kit).toSorted()).toEqual([
      "NineSlice",
      "Sprite",
      "defineAnimation",
      "defineBundles",
      "defineFeature",
      "defineFlow",
      "defineNode",
      "defineScene",
      "frames",
      "load",
      "music",
      "play",
      "projection",
      "sfx",
      "sprite",
      "tr"
    ]);
  });

  it("exports no genre rules", () => {
    expect(Object.keys(engine)).not.toContain("rules");
  });
});
