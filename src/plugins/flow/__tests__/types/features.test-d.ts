import { describe, expectTypeOf, it } from "vitest";
import type { Flow } from "../../../../index";
import { createApp, createPlugin, defineFeature, flattenFeatures } from "../../../../index";

// What a game can get wrong with the feature tree. Each `@ts-expect-error` fails the build in both
// directions: the mistake must error, and a correct line under one would be an unused directive.

const ep01Feature = defineFeature("ep01", {});
const kitFeature = defineFeature("kit", {});
const episodesFeature = defineFeature("episodes", { features: [kitFeature, ep01Feature] });
const plainPlugin = createPlugin("plain", {});

// `features` takes only feature plugins.
// @ts-expect-error — a logicOnly is a logic plugin, not a feature: it has no logicOnly of its own
defineFeature("episodes", { features: [ep01Feature.logicOnly] });
// @ts-expect-error — a createPlugin result is no feature: it has neither logicOnly nor features
defineFeature("episodes", { features: [plainPlugin] });

describe("the feature tree", () => {
  it("flattens a full tree and a logicOnly tree into a plugin list createApp takes", () => {
    expectTypeOf(flattenFeatures([episodesFeature])).toEqualTypeOf<Flow.FeatureTree[]>();
    createApp({ plugins: flattenFeatures([episodesFeature]) });
    createApp({ plugins: [...flattenFeatures([episodesFeature.logicOnly])] });
  });

  it("types the parent of a registry entry as an optional name", () => {
    const app = createApp({ plugins: flattenFeatures([episodesFeature.logicOnly]) });

    expectTypeOf(app.flow.features.all()[0]?.parent).toEqualTypeOf<string | undefined>();
    expectTypeOf(app.flow.features.all()).toEqualTypeOf<readonly Flow.RegisteredFeature[]>();
  });
});
