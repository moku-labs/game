/**
 * @file The filter bench as one data object: one rest node, one scene, and the plugin that puts a
 * measured scene on it. The worst filter cases of a real game, one at a time, for the A26 run.
 * The engine comes from the sources, `../../src/`, never from a built `dist/` (R10).
 */
import { defineGameApp } from "../../src/app.ts";
import { benchFeature, benchFlow } from "./features/bench";
import { benchPlugin } from "./plugins/bench";

export default defineGameApp({
  flow: benchFlow,
  safeNode: "bench",
  player: {},
  session: {},
  referenceSide: 390,
  referenceLong: 844,
  features: [benchFeature],
  plugins: [benchPlugin],
  // Every frame drawn, at one resolution: a measurement never adapts itself away.
  pluginConfigs: { renderer: { onDemand: false, adaptiveScale: false } }
});
