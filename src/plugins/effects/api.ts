/**
 * @file effects plugin — API factory. A game does everything with effects as data on entities;
 * the API only counts, and asks the renderer for its render passes at call time.
 */
import { rendererPlugin } from "../renderer";
import type { EffectsApi, EffectsStats, KernelSlice, State } from "./types";

/**
 * The filter instances over every view.
 *
 * @param state - The plugin state.
 * @returns How many there are.
 */
function countFilters(state: State): number {
  let count = 0;

  for (const view of state.views.values()) count += view.instances.size;

  return count;
}

/**
 * Creates the effects API.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @returns The plugin API.
 */
export function createEffectsApi(ctx: KernelSlice): EffectsApi {
  const state = ctx.state;

  return {
    stats: (): EffectsStats => ({
      particles: state.particles,
      emitters: state.instances.size + state.orphans.size,
      filters: countFilters(state),
      renderPasses: ctx.require(rendererPlugin).sync.renderPasses()
    })
  };
}
