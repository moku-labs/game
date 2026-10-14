import type { AnyPluginInstance } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import { defineFeature } from "../../feature";
import type { FeatureDescription, FeaturePlugin } from "../../features/types";
import { flowPlugin } from "../../index";
import type { AnyFlow } from "../../runner/types";

// ---------------------------------------------------------------------------
// Unit test: defineFeature (no app; onInit is called with a fake context)
// ---------------------------------------------------------------------------

const flowOf = (id: string): AnyFlow => ({
  kind: "flow",
  id,
  input: { kind: "type" },
  outcomes: { done: { kind: "type" } },
  nodes: {},
  start: "begin",
  edges: {}
});

const engineNames = [
  "time",
  "lifecycle",
  "model",
  "clock",
  "flow",
  "world",
  "renderer",
  "input",
  "assets",
  "scenes",
  "anim",
  "i18n",
  "text",
  "ui",
  "effects",
  "audio",
  "platform"
];

const coreNames = ["log", "env"];

const kernelNames = [
  "start",
  "stop",
  "emit",
  "require",
  "has",
  "config",
  "global",
  "state",
  "__proto__",
  "constructor",
  "prototype"
];

// The kernel's plugin context. `require` is generic over the plugin instance, so a fake that
// answers with one API only cannot be typed structurally; the repo mocks it the same way in
// src/plugins/lifecycle/__tests__/unit/api.test.ts.
type InitContext = Parameters<NonNullable<AnyPluginInstance["spec"]["onInit"]>>[0];

type Registration = { name: string; description: FeatureDescription };

const runInit = (
  plugin: AnyPluginInstance,
  has: (name: string) => boolean = () => true,
  calls: Registration[] = []
) => {
  const features = {
    register: (name: string, description: FeatureDescription): void => {
      calls.push({ name, description });
    }
  };
  const ctx = {
    global: {},
    config: {},
    state: {},
    emit: () => {},
    require: () => ({ features }),
    has
  };

  plugin.spec.onInit?.(ctx as unknown as InitContext);

  return calls;
};

const description: FeatureDescription = {
  flows: [flowOf("board")],
  nodes: [],
  contribute: { afterWin: { flow: flowOf("reward"), order: 10 } }
};

// ─── the plugin it builds ─────────────────────────────────────

describe("defineFeature", () => {
  it("names the plugin after the feature", () => {
    expect(defineFeature("board", description).name).toBe("board");
  });

  it("depends on the flow plugin", () => {
    expect(defineFeature("board", description).spec.depends).toEqual([flowPlugin]);
  });

  it("registers the feature in onInit", () => {
    const calls = runInit(defineFeature("board", description));

    expect(calls).toEqual([{ name: "board", description }]);
  });

  it("registers nothing before onInit runs", () => {
    const feature = defineFeature("board", description);

    expect(feature.spec.onInit).toBeTypeOf("function");
  });

  it("has no api, state or events of its own", () => {
    const feature = defineFeature("board", description);

    expect(feature.spec.api).toBeUndefined();
    expect(feature.spec.createState).toBeUndefined();
    expect(feature.spec.hooks).toBeUndefined();
  });
});

// ─── logicOnly ────────────────────────────────────────────────

describe("logicOnly", () => {
  it("is a plugin of the same name", () => {
    const feature = defineFeature("board", description);

    expect(feature.logicOnly.name).toBe("board");
  });

  it("is not the same plugin instance", () => {
    const feature = defineFeature("board", description);

    expect(feature.logicOnly).not.toBe(feature);
  });

  it("depends on the flow plugin too", () => {
    expect(defineFeature("board", description).logicOnly.spec.depends).toEqual([flowPlugin]);
  });

  it("registers only the V1 keys of the description", () => {
    const feature = defineFeature("board", {
      ...description,
      components: [{ id: "cell" }],
      scenes: ["board"]
    });

    const calls = runInit(feature.logicOnly);

    expect(calls[0]?.description).toEqual({
      nodes: description.nodes,
      flows: description.flows,
      contribute: description.contribute
    });
  });

  it("drops every key the V2 plugins read", () => {
    const feature = defineFeature("board", {
      ...description,
      projections: [{ name: "items" }],
      systems: [{ name: "highlight" }],
      components: [{ id: "cell" }],
      scenes: [{ id: "board" }],
      assets: { board: ["board.cell"] }
    });

    const calls = runInit(feature.logicOnly);

    expect(Object.keys(calls[0]?.description ?? {})).toEqual(["nodes", "flows", "contribute"]);
  });

  it("drops every key the V3 plugins read", () => {
    const feature = defineFeature("board", {
      ...description,
      animations: [{ id: "coinsFly" }],
      ui: [{ name: "RewardPopup" }],
      strings: { en: { "board.title": () => [] } },
      textStyles: { kind: "textStyles", map: { title: { size: 24 } } }
    });

    const calls = runInit(feature.logicOnly);

    expect(Object.keys(calls[0]?.description ?? {})).toEqual(["nodes", "flows", "contribute"]);
  });

  it("registers the V3 keys through the feature itself", () => {
    const feature = defineFeature("board", {
      ...description,
      animations: [{ id: "coinsFly" }],
      ui: [{ name: "RewardPopup" }],
      textStyles: { kind: "textStyles", map: { title: { size: 24 } } }
    });

    const calls = runInit(feature);

    expect(calls[0]?.description.animations).toEqual([{ id: "coinsFly" }]);
    expect(calls[0]?.description.ui).toEqual([{ name: "RewardPopup" }]);
    expect(calls[0]?.description.textStyles).toEqual({
      kind: "textStyles",
      map: { title: { size: 24 } }
    });
  });

  it("drops the emitters and filters effects reads", () => {
    const feature = defineFeature("board", {
      ...description,
      emitters: [{ id: "coins" }],
      filters: [{ componentName: "RewardPopup", filter: { id: "glow" } }]
    });

    const calls = runInit(feature.logicOnly);

    expect(Object.keys(calls[0]?.description ?? {})).toEqual(["nodes", "flows", "contribute"]);
  });

  it("registers emitters and filters through the feature itself", () => {
    const feature = defineFeature("board", {
      ...description,
      emitters: [{ id: "coins" }],
      filters: [{ componentName: "RewardPopup", filter: { id: "glow" } }]
    });

    const calls = runInit(feature);

    expect(calls[0]?.description.emitters).toEqual([{ id: "coins" }]);
    expect(calls[0]?.description.filters).toEqual([
      { componentName: "RewardPopup", filter: { id: "glow" } }
    ]);
  });

  it("keeps the V1 values by reference", () => {
    const calls = runInit(defineFeature("board", description).logicOnly);

    expect(calls[0]?.description.flows).toBe(description.flows);
  });

  it("leaves absent V1 keys out", () => {
    const calls = runInit(defineFeature("board", { flows: [flowOf("board")] }).logicOnly);

    expect(Object.keys(calls[0]?.description ?? {})).toEqual(["flows"]);
  });

  it("registers the full description through the feature itself", () => {
    const feature = defineFeature("board", { ...description, scenes: ["board"] });
    const calls = runInit(feature);

    expect(calls[0]?.description.scenes).toEqual(["board"]);
  });
});

// ─── reserved names ───────────────────────────────────────────

describe("reserved names", () => {
  it.each(engineNames)("refuses the engine plugin name %s", name => {
    expect(() => defineFeature(name, description)).toThrow(/^\[game] Feature name /);
  });

  it.each(coreNames)("refuses the core plugin name %s", name => {
    expect(() => defineFeature(name, description)).toThrow(/^\[game] Feature name /);
  });

  it.each(kernelNames)("refuses the kernel reserved name %s", name => {
    expect(() => defineFeature(name, description)).toThrow(/^\[game] Feature name /);
  });

  it("says what is wrong and what to do", () => {
    expect(() => defineFeature("flow", description)).toThrow(
      '[game] Feature name "flow" is reserved or already a plugin.\n  Choose another feature name.'
    );
  });

  it("accepts a name of its own", () => {
    expect(() => defineFeature("board", description)).not.toThrow();
  });

  it("accepts a name that only contains a reserved name", () => {
    expect(() => defineFeature("flowBoard", description)).not.toThrow();
  });

  it("refuses an empty name", () => {
    expect(() => defineFeature("", description)).toThrow(/^\[game] /);
  });
});

// ─── sub-features ─────────────────────────────────────────────

const notComposed =
  '[game] Feature "episodes" declares the sub-feature "ep01", but the app does not compose it.\n' +
  "  Compose the whole tree: defineGameApp does it, a raw createApp takes flattenFeatures([...]).";

const tree = () => {
  const kit = defineFeature("kit", {});
  const ep01 = defineFeature("ep01", { flows: [flowOf("ep01.play")] });
  const episodes = defineFeature("episodes", { features: [kit, ep01] });

  return { kit, ep01, episodes };
};

describe("sub-features", () => {
  it("a parent carries its sub-features in declaration order, and a leaf carries none", () => {
    const { kit, ep01, episodes } = tree();

    expect(episodes.features).toHaveLength(2);
    expect(episodes.features[0]).toBe(kit);
    expect(episodes.features[1]).toBe(ep01);
    expect(kit.features).toEqual([]);
    expect(kit.logicOnly.features).toEqual([]);
  });

  it("the logicOnly of a parent carries the logicOnly of each sub-feature", () => {
    const { kit, ep01, episodes } = tree();

    expect(episodes.logicOnly.features).toHaveLength(2);
    expect(episodes.logicOnly.features[0]).toBe(kit.logicOnly);
    expect(episodes.logicOnly.features[1]).toBe(ep01.logicOnly);
  });

  it("logicOnly keeps the features key of the description", () => {
    const { kit, ep01 } = tree();
    const children = [kit, ep01];
    const episodes = defineFeature("episodes", { features: children, ui: [{ name: "Picker" }] });

    const calls = runInit(episodes.logicOnly);

    expect(calls[0]?.description.features).toBe(children);
    expect(Object.keys(calls[0]?.description ?? {})).toEqual(["features"]);
  });

  it("a parent's onInit throws, naming itself and the missing sub-feature, when the app does not compose it", () => {
    const { episodes } = tree();
    const calls: Registration[] = [];

    expect(() => runInit(episodes, name => name !== "ep01", calls)).toThrow(notComposed);
    expect(calls).toEqual([]);
  });

  it("the logicOnly of a parent checks its sub-features the same way", () => {
    const { episodes } = tree();
    const calls: Registration[] = [];

    expect(() => runInit(episodes.logicOnly, name => name !== "ep01", calls)).toThrow(notComposed);
    expect(calls).toEqual([]);
  });

  it("a parent registers once every sub-feature is composed", () => {
    const { episodes } = tree();
    const asked: string[] = [];

    const calls = runInit(episodes, name => {
      asked.push(name);

      return true;
    });

    expect(asked).toEqual(["kit", "ep01"]);
    expect(calls.map(call => call.name)).toEqual(["episodes"]);
  });

  it("defineFeature throws for an entry of features that is not a feature, naming its index", () => {
    const { kit, ep01 } = tree();
    // A game in JavaScript, or one that casts: a logic plugin and a bare object are no features.
    const logicPlugin = ep01.logicOnly as unknown as FeaturePlugin;
    const bare = { name: "ep02", logicOnly: kit.logicOnly } as unknown as FeaturePlugin;

    expect(() => defineFeature("episodes", { features: [kit, logicPlugin] })).toThrow(
      '[game] Feature "episodes": features[1] is not a feature.\n' +
        "  Make it with defineFeature(name, description)."
    );
    expect(() => defineFeature("episodes", { features: [bare] })).toThrow(
      '[game] Feature "episodes": features[0] is not a feature.'
    );
  });

  it("a push to the game's array after defineFeature does not change the tree", () => {
    const { kit, ep01 } = tree();
    const children = [kit];
    const episodes = defineFeature("episodes", { features: children });

    children.push(ep01);

    expect(episodes.features.map(child => child.name)).toEqual(["kit"]);
    expect(episodes.logicOnly.features.map(child => child.name)).toEqual(["kit"]);
  });
});
