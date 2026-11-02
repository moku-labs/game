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

/** The layer of the K full-screen sprites, under everything. */
export const BALLAST_LAYER = "ballast";

/** The layer of the scene. */
export const MAIN_LAYER = "main";

/** The rest node the bench stands on, for as long as the page is open. */
const bench = defineNode({
  scene: "bench",
  outcomes: { go: type() },
  rest: true,
  checkpoint: true
});

/** The graph: one node. */
export const benchFlow = defineFlow("main", {
  nodes: { bench },
  start: "bench",
  edges: { bench: { go: "bench" } }
});

/** The scene: the ballast under the measured views. */
const benchSceneDefinition = defineScene("bench", {
  bundle: "ui",
  layers: { [BALLAST_LAYER]: { sort: "none" }, [MAIN_LAYER]: { sort: "none" } },
  projections: []
});

/** The stream of the `fade` scene: a particle container that changes in every frame. */
const ember = defineEmitter("fx.ember", {
  textures: ["ui.fx-spark"],
  rate: 20,
  lifeMs: [400, 800],
  speed: [40, 120],
  maxParticles: 32
});

export const benchFeature = defineFeature("filterBench", {
  scenes: [benchSceneDefinition],
  filters: BENCH_FILTERS,
  emitters: [ember],
  textStyles: defineTextStyles({
    "bench.digits": { font: "ui.font-body", size: 32, fill: 0xff_ff_ff, digits: true }
  }),
  assets: uiAssets
});
