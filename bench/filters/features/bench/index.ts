/**
 * @file The bench as a feature: its graph of one rest node, its scene with the two layers, its own
 * filters and the ember of the `fade` scene. What stands on the scene comes from the bench plugin.
 */
import { type } from "../../../../src/index.ts";
import {
  defineEmitter,
  defineFeature,
  defineFlow,
  defineNode,
  defineScene,
  defineTextStyles
} from "../../kit";
import { uiAssets } from "../ui/assets";
import { BENCH_FILTERS } from "./filters";
import { transitionLeave } from "./scenes/trans";

/** The layer of the K full-screen sprites, under everything. */
export const BALLAST_LAYER = "ballast";

/** The layer of the scene. */
export const MAIN_LAYER = "main";

/** The rest node the bench stands on, for as long as the page is open. `over` is the switch of the `trans-*` arms. */
const bench = defineNode({
  scene: "bench",
  outcomes: { go: type(), over: type() },
  rest: true,
  checkpoint: true
});

/** The other side of a `trans-*` arm: a rest node on the second scene. */
const away = defineNode({
  scene: "bench-b",
  outcomes: { back: type() },
  rest: true,
  checkpoint: true
});

/** The graph: the rest node, and the one the `trans-*` arms switch to and back. */
export const benchFlow = defineFlow("main", {
  nodes: { bench, away },
  start: "bench",
  edges: { bench: { go: "bench", over: "away" }, away: { back: "bench" } }
});

/**
 * One scene of the graph: the ballast under the measured views. Both leave with the transition the arm on screen
 * names, which is what a `trans-*` arm measures.
 *
 * @param id - The scene.
 * @returns Its definition.
 */
function sceneOf(id: "bench" | "bench-b") {
  return defineScene(id, {
    bundle: "ui",
    layers: { [BALLAST_LAYER]: { sort: "none" }, [MAIN_LAYER]: { sort: "none" } },
    projections: [],
    leave: transitionLeave
  });
}

/** The stream of the `fade` scene: a particle container that changes in every frame. */
const ember = defineEmitter("fx.ember", {
  textures: ["ui.fx-spark"],
  rate: 20,
  lifeMs: [400, 800],
  speed: [40, 120],
  maxParticles: 32
});

export const benchFeature = defineFeature("filterBench", {
  scenes: [sceneOf("bench"), sceneOf("bench-b")],
  filters: BENCH_FILTERS,
  emitters: [ember],
  textStyles: defineTextStyles({
    "bench.digits": { font: "ui.font-body", size: 32, fill: 0xff_ff_ff, digits: true }
  }),
  assets: uiAssets
});
