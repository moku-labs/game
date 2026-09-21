/**
 * @file lifecycle plugin — API factory skeleton.
 */
import type { Api, LifecycleCtx } from "./types";

/**
 * Creates the lifecycle API: `push` and `pop` of pause reasons, a frozen copy of the stack and
 * `isPaused`. The first reason pauses `time`, the last one to leave resumes it, and every real
 * change of the stack emits `lifecycle:changed`. Resolves `time` with `ctx.require` inside.
 *
 * @param _ctx - Domain context of the lifecycle plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const api = createLifecycleApi(ctx);
 * api.push("background");
 * ```
 */
export function createLifecycleApi(_ctx: LifecycleCtx): Api {
  throw new Error("not implemented");
}
