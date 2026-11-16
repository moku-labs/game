import { describe, expect, it } from "vitest";
import { namedBundles } from "../../bundles";
import type { NamedMemo, SceneDefinition } from "../../types";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: what a scene names, asked again with the same committed state (F194): the switch, a re-read, the progress
// table and the look-ahead of `assets` all ask, and a rest asks for every scene of the neighbourhood.
// ---------------------------------------------------------------------------

const scene: SceneDefinition = {
  id: "ward",
  bundle: "location",
  music: undefined,
  layers: [],
  projections: [],
  bundles: ({ session }) => [(session as { episode: string }).episode]
};

describe("namedBundles, heap bytes per call", () => {
  // Bug: a hit builds the state, the list or a memo entry again.
  it("the same committed trees again: nothing", () => {
    const memo = new WeakMap<SceneDefinition, NamedMemo>();
    const state = { player: {}, session: { episode: "ep01" } };

    expect(bytesPerCall(() => void namedBundles(scene, state, memo))).toBeLessThanOrEqual(
      BUDGET.namedHit + NOISE
    );
  });
});
