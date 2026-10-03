/**
 * @file Testing entry (subpath `./testing`) — re-exports only: headless play, repro runs, the
 * in-memory save provider, the fake clock and the visual tests. The visual runner reads and
 * writes baseline files, so this entry is node and bun only, and it is the one module that
 * imports `src/visual/` (L12).
 */
export { fakeClock } from "./plugins/clock/fake";
export type { HeadlessApp, HeadlessGame, Repro, ReproResult } from "./plugins/flow/headless";
export { createHeadless, runRepro, stepFrames } from "./plugins/flow/headless";
export { memory, saveOf } from "./plugins/model/store/providers/memory";
export { defineVisualTest } from "./visual/define";
export { parseVisualArgv, runVisualTests } from "./visual/run";
export type {
  CheckpointResult,
  VisualOptions,
  VisualPage,
  VisualReport,
  VisualSetup,
  VisualStart,
  VisualStep,
  VisualTest,
  VisualTestResult,
  VisualTolerance
} from "./visual/types";
