import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { namedBundles } from "../../bundles";
import type { NamedMemo, SceneDefinition } from "../../types";

const scene: SceneDefinition = {
  id: "ward",
  bundle: "location",
  music: undefined,
  layers: [],
  projections: [],
  bundles: ({ session }) => [(session as { episode: string }).episode]
};
const memo = new WeakMap<SceneDefinition, NamedMemo>();
const state = { player: {}, session: { episode: "ep01" } };

describe("namedBundles (F194)", () => {
  bench(
    "the same committed trees again, from the memo",
    () => void namedBundles(scene, state, memo),
    BENCH_OPTIONS
  );
  bench("no memo: the scene asked", () => void namedBundles(scene, state), BENCH_OPTIONS);
});
