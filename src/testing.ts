/**
 * @file Testing entry (subpath `./testing`) — re-exports only: headless play, repro runs, the
 * in-memory save provider and the fake clock.
 */
export { fakeClock } from "./plugins/clock/fake";
export type { HeadlessApp, HeadlessGame, Repro, ReproResult } from "./plugins/flow/headless";
export { createHeadless, runRepro, stepFrames } from "./plugins/flow/headless";
export { memory, saveOf } from "./plugins/model/store/providers/memory";
