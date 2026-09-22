/**
 * @file scenes plugin — API factory. One member: a scene is switched by the graph, never by a
 * call, so the plugin answers a question and takes no orders.
 */
import type { KernelSlice, ScenesApi } from "./types";

/**
 * Creates the scenes API: `app.scenes.current()`.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The plugin API.
 */
export function createScenesApi(ctx: KernelSlice): ScenesApi {
  return { current: () => ctx.state.current };
}
