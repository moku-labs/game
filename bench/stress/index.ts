/**
 * @file The stress bench as one data object: the heaviest screens of a real game at real scale and beyond, each
 * driving itself, for the Mac and the A26. The engine comes from the sources, `../../src/`, never from `dist/`.
 */
import { defineGameApp } from "../../src/app.ts";
import { stressFeature, stressFlow } from "./features/stress";
import { stressPlugin } from "./plugins/stress";
import { startingPlayer, startingSession } from "./state";

export default defineGameApp({
  flow: stressFlow,
  safeNode: "stage",
  player: startingPlayer,
  session: startingSession,
  referenceSide: 390,
  referenceLong: 844,
  features: [stressFeature],
  plugins: [stressPlugin],
  // Every frame drawn, at one resolution: a measurement never adapts itself away.
  pluginConfigs: { renderer: { onDemand: false, adaptiveScale: false } }
});
