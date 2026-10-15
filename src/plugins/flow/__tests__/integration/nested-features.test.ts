import type { AnyPluginInstance } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, flattenFeatures, type } from "../../../../index";

// ---------------------------------------------------------------------------
// Integration: a parent feature and its sub-features through the real kernel, headless. The
// parent `episodes` owns the flow `episodes.pick`, whose rest node enters the sub-flow `ep01.play`
// of the sub-feature `ep01`; the sibling `kit` has no flow.
// ---------------------------------------------------------------------------

type Player = { finished: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

const play = defineNode({ rest: true, outcomes: { finish: type() } });

const ep01Flow = defineFlow("ep01.play", {
  nodes: { play },
  start: "play",
  outcomes: { done: type() },
  edges: { play: { finish: exit("done") } }
});

const pick = defineNode({ rest: true, outcomes: { ep01: type() } });

const pickFlow = defineFlow("episodes.pick", {
  nodes: { pick, ep01: ep01Flow },
  start: "pick",
  edges: { pick: { ep01: "ep01" }, ep01: { done: "pick" } }
});

const kitFeature = defineFeature("kit", {});
const ep01Feature = defineFeature("ep01", { flows: [ep01Flow] });
const episodesFeature = defineFeature("episodes", {
  features: [kitFeature, ep01Feature],
  flows: [pickFlow]
});

/**
 * Creates the headless app of the episodes game from a plugin list, as a raw `createApp` does.
 *
 * @param plugins - The plugin list the test composes.
 * @returns The app, not started.
 */
const appOf = (plugins: readonly AnyPluginInstance[]) =>
  createApp({
    plugins: [...plugins],
    pluginConfigs: {
      flow: { mainFlow: pickFlow },
      model: { initialPlayer: { finished: 0 }, initialSession: {}, seed: 1 }
    }
  });

describe("nested features", () => {
  it("a raw createApp with flattenFeatures runs the graph into a sub-feature's flow: describe() names the sub-feature as the owner of its nodes and features.all() names its parent", async () => {
    const app = appOf(flattenFeatures([episodesFeature.logicOnly]));

    await app.start();
    app.flow.run().catch(() => undefined);
    await app.flow.walk([]);
    const state = await app.flow.walk([{ at: "pick", intent: "ep01" }]);

    expect(state.path).toBe("ep01/play");
    const graph = app.flow.describe();
    expect(graph.flows["episodes.pick"]?.nodes.pick?.owner).toBe("episodes");
    expect(graph.flows["episodes.pick"]?.nodes.ep01?.owner).toBe("ep01");
    expect(graph.flows["ep01.play"]?.nodes.play?.owner).toBe("ep01");
    expect(app.flow.features.all().map(({ name, parent }) => ({ name, parent }))).toEqual([
      { name: "episodes", parent: undefined },
      { name: "kit", parent: "episodes" },
      { name: "ep01", parent: "episodes" }
    ]);

    await app.stop();
  });

  it("createApp with the parent alone throws at creation, naming the missing sub-feature", () => {
    const missingKit =
      '[game] Feature "episodes" declares the sub-feature "kit", but the app does not compose it.';

    expect(() => appOf([episodesFeature])).toThrow(missingKit);
    expect(() => appOf([episodesFeature.logicOnly])).toThrow(missingKit);
  });

  it("composes the children before their parent without a throw: the check is order independent", () => {
    const app = appOf([kitFeature.logicOnly, ep01Feature.logicOnly, episodesFeature.logicOnly]);

    expect(app.flow.features.all().map(({ name, parent }) => `${parent ?? "-"}/${name}`)).toEqual([
      "episodes/kit",
      "episodes/ep01",
      "-/episodes"
    ]);
  });
});
