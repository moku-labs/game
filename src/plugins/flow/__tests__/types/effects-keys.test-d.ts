import { describe, expectTypeOf, it } from "vitest";
import { defineFeature } from "../../feature";
import type { FeatureDescription, FeatureEmitter, FeatureFilter } from "../../features/types";
import type { EmitterIdOf, GameTypes } from "../../types";

// Delta 8 addendum: the feature keys and the game types `effects` reads. Checked by `tsc`.

type Empty = Record<string, never>;
type Base = { player: Empty; session: Empty; assets: string; strings: Empty };

describe("feature keys of effects", () => {
  it("types emitters and filters on a feature description", () => {
    const description: FeatureDescription = {
      emitters: [{ id: "coins" }],
      filters: [{ componentName: "RewardPopup", filter: { id: "glow" } }]
    };

    expectTypeOf(description.emitters).toEqualTypeOf<readonly FeatureEmitter[] | undefined>();
    expectTypeOf(description.filters).toEqualTypeOf<readonly FeatureFilter[] | undefined>();
    expectTypeOf(defineFeature("reward", description).logicOnly.name).toBeString();
  });

  it("rejects an emitter without an id", () => {
    // @ts-expect-error an emitter needs its id
    const description: FeatureDescription = { emitters: [{ effect: "coins" }] };

    expectTypeOf(description).toEqualTypeOf<FeatureDescription>();
  });

  it("rejects a filter without its component name", () => {
    // @ts-expect-error a filter names the component it wraps
    const description: FeatureDescription = { filters: [{ filter: { id: "glow" } }] };

    expectTypeOf(description).toEqualTypeOf<FeatureDescription>();
  });
});

describe("EmitterIdOf", () => {
  it("narrows to the emitter ids of the game", () => {
    expectTypeOf<EmitterIdOf<Base & { emitters: "coins" | "sparks" }>>().toEqualTypeOf<
      "coins" | "sparks"
    >();
  });

  it("falls back to string when the game passed none", () => {
    expectTypeOf<EmitterIdOf<Base>>().toEqualTypeOf<string>();
  });

  it("accepts emitters as an optional key of GameTypes", () => {
    expectTypeOf<Base & { emitters: "coins" }>().toExtend<GameTypes>();
  });
});
