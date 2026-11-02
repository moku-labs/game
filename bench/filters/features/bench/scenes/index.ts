/**
 * @file The table of the scenes.
 */
import { CASE_SCENES } from "./cases";
import { SLOPE_SCENES } from "./slope";
import type { BenchScene } from "./types";

/** The scene of the ballast alone: the K sprites, nothing on top. */
const ballastScene: BenchScene = {
  name: "ballast",
  stands: "no filter: K full-screen batched sprites, the fill that holds the GPU clock",
  mount: () => undefined
};

/** Every scene of the bench. */
export const SCENES: readonly BenchScene[] = [ballastScene, ...SLOPE_SCENES, ...CASE_SCENES];
