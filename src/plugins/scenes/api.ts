/**
 * @file scenes plugin — API factory. A scene is switched by the graph, never by a call, so the
 * plugin answers one question and takes one order, for the restore door: the scene to expect.
 */
import type { KernelSlice, ScenesApi } from "./types";

/**
 * Creates the scenes API: `app.scenes.current()` and `app.scenes.expect(id)`.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The plugin API.
 */
export function createScenesApi(ctx: KernelSlice): ScenesApi {
  return {
    current: () => ctx.state.current,
    expect: (id: string): void => {
      if (!ctx.state.scenes.has(id)) {
        throw new Error(
          `[game] Scene "${id}" is not registered.\n  List it in the scenes of a feature.`
        );
      }

      ctx.state.pending = id;
    }
  };
}
