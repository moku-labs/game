import { readFileSync } from "node:fs";
import * as engine from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { defineFlow, defineNode } from "../../src/plugins/flow/runner/define";

/** The `src` folder of the repository. */
const SRC = new URL("../../src/", import.meta.url);

/**
 * Collect the names in every `import { … } from "./plugins"` and `export { … } from "./plugins"`
 * of a source text.
 *
 * @param source - The text of a TypeScript file.
 * @returns The names inside the braces, without `type` imports.
 */
function namedFromPlugins(source: string): string[] {
  const statements = source.matchAll(/(?:import|export) \{([^}]*)\} from "\.\/plugins";/g);
  return [...statements].flatMap(([, names = ""]) =>
    names
      .split(",")
      .map(name => name.trim())
      .filter(name => name !== "")
  );
}

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
    expect(kit.Frames).toBe(engine.Frames);
    expect(kit.sfx).toBe(engine.sfx);
    expect(kit.play).toBe(engine.play);
    expect(kit.tr).toBe(engine.tr);
    expect(kit.music).toBe(engine.music);
    expect(kit.defineEmitter).toBe(engine.defineEmitter);
    expect(kit.Emitter).toBe(engine.Emitter);
    expect(kit.Displacement).toBe(engine.Displacement);
    expect(Object.keys(kit).toSorted()).toEqual([
      "Displacement",
      "Emitter",
      "Frames",
      "NineSlice",
      "Sprite",
      "defineAnimation",
      "defineBundles",
      "defineComponent",
      "defineEmitter",
      "defineFeature",
      "defineFlow",
      "defineNode",
      "defineScene",
      "defineStyle",
      "defineTextStyles",
      "defineTokens",
      "frames",
      "intrinsics",
      "label",
      "load",
      "music",
      "play",
      "popup",
      "projection",
      "sfx",
      "sprite",
      "tr"
    ]);
  });

  it("exports the trace components of input", () => {
    expect(engine.Traceable.componentName).toBe("Traceable");
    expect(engine.Traced.componentName).toBe("Traced");
  });

  it("exports no genre rules", () => {
    expect(Object.keys(engine)).not.toContain("rules");
  });

  it("names every plugin value of the barrel, so Bun's dev bundler keeps it", () => {
    const barrel = readFileSync(new URL("plugins/index.ts", SRC), "utf8");
    const plugins = [...barrel.matchAll(/export \{ (\w+Plugin) \} from/g)].map(([, name]) => name);
    const named = namedFromPlugins(readFileSync(new URL("index.ts", SRC), "utf8"));

    expect(plugins).toHaveLength(17);
    expect(plugins.filter(name => name !== undefined && !named.includes(name))).toEqual([]);
  });
});
