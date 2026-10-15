import { describe, expect, it } from "vitest";
import { defineFeature, flattenFeatures } from "../../feature";
import type { FeatureTree } from "../../features/types";

// ---------------------------------------------------------------------------
// Unit test: flattenFeatures (pure, no app)
// ---------------------------------------------------------------------------

/**
 * A three-level tree: home, episodes with kit and ep01, ep01 with ep01a, then shop.
 *
 * @returns The features, each by name.
 */
const tree = () => {
  const home = defineFeature("home", {});
  const kit = defineFeature("kit", {});
  const ep01a = defineFeature("ep01a", {});
  const ep01 = defineFeature("ep01", { features: [ep01a] });
  const episodes = defineFeature("episodes", { features: [kit, ep01] });
  const shop = defineFeature("shop", {});

  return { home, episodes, kit, ep01, ep01a, shop };
};

describe("flattenFeatures", () => {
  it("flattens depth-first, a parent before its sub-features, in declaration order", () => {
    const { home, episodes, kit, ep01, ep01a, shop } = tree();
    const order = [home, episodes, kit, ep01, ep01a, shop];

    const flat = flattenFeatures([home, episodes, shop]);

    expect(flat.map(plugin => order.indexOf(plugin as (typeof order)[number]))).toEqual([
      0, 1, 2, 3, 4, 5
    ]);
  });

  it("flattens a logicOnly tree into the logic plugins only", () => {
    const { home, episodes, kit, ep01, ep01a } = tree();
    const logic: FeatureTree[] = [
      home.logicOnly,
      episodes.logicOnly,
      kit.logicOnly,
      ep01.logicOnly,
      ep01a.logicOnly
    ];

    const flat = flattenFeatures([home.logicOnly, episodes.logicOnly]);

    expect(flat.map(plugin => logic.indexOf(plugin))).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns a flat list as it was: the same instances in the same order", () => {
    const { home, shop } = tree();
    const list = [shop, home];

    const flat = flattenFeatures(list);

    expect(flat).toHaveLength(2);
    expect(flat[0]).toBe(shop);
    expect(flat[1]).toBe(home);
  });

  it("a cast non-feature entry throws, naming its path at any depth", () => {
    const { home, kit } = tree();
    // A game in JavaScript, or one that casts: a plain plugin has no features list.
    const plain = { name: "plain", spec: {} } as unknown as FeatureTree;
    const broken = { name: "episodes", spec: {}, features: [kit, plain] } as unknown as FeatureTree;

    expect(() => flattenFeatures([home, plain])).toThrow(
      "[game] flattenFeatures: list[1] is not a feature.\n" +
        "  Make it with defineFeature(name, description)."
    );
    expect(() => flattenFeatures([broken])).toThrow(
      "[game] flattenFeatures: list[0].features[1] is not a feature."
    );
  });
});
