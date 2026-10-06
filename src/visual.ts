/**
 * @file Visual entry (subpath `./visual`) — re-exports only: the visual tests. A visual test is
 * data; the runner plays it headless and in Chrome, and reads and writes baseline files, so this
 * entry is node and bun only, and it is the one module that imports `src/visual/` (L12).
 */
export { defineVisualTest } from "./visual/define";
export { parseVisualArgv, runVisualTests } from "./visual/run";
export type {
  CheckpointResult,
  VisualApp,
  VisualOptions,
  VisualPage,
  VisualRenderer,
  VisualReport,
  VisualSetup,
  VisualStart,
  VisualStep,
  VisualTest,
  VisualTestResult,
  VisualTolerance
} from "./visual/types";
