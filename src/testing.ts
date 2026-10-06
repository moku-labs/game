/**
 * @file Testing entry (subpath `./testing`) — re-exports only: headless play, repro runs, the
 * in-memory save provider and the fake clock. It imports no `node:` module, so a test that runs
 * in a browser can import it. The visual tests live in `./visual`.
 */
export { fakeClock } from "./plugins/clock/fake";
export type { HeadlessApp, HeadlessGame, Repro, ReproResult } from "./plugins/flow/headless";
export { createHeadless, runRepro, stepFrames } from "./plugins/flow/headless";
export { memory, saveOf } from "./plugins/model/store/providers/memory";
