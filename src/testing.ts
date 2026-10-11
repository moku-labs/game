/**
 * @file Testing entry (subpath `./testing`) — re-exports only: headless play, repro runs, isolated
 * feature tests, the `fx` of a node context for a unit test, the in-memory save provider and the
 * fake clock. It imports no `node:` module, so a test that runs in a browser can import it. The
 * visual tests live in `./visual`.
 */
export { fakeClock } from "./plugins/clock/fake";
export type { HeadlessApp, HeadlessGame, Repro, ReproResult } from "./plugins/flow/headless";
export { createHeadless, runRepro, stepFrames } from "./plugins/flow/headless";
export { memory, saveOf } from "./plugins/model/store/providers/memory";
export type { FakeFx, FakeFxOptions } from "./testing/fake-fx";
export { fakeFx } from "./testing/fake-fx";
export type { IsolateOptions, IsolateSeams, Stub, StubsOf } from "./testing/isolate";
export { isolate, stub } from "./testing/isolate";
