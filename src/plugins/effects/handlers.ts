/**
 * @file effects plugin — the one hook: a bundle that left takes the effects drawn with its
 * textures along, particles and `Displacement` maps alike, whatever their space.
 */
import { retireFilterMaps } from "./filters/system";
import { withDeps } from "./lifecycle";
import { retireParticleKeys } from "./particles/system";
import type { BundleUnloaded, EffectsCtx, KernelSlice } from "./types";

/**
 * Creates the hook handlers. The domain context is built when the hook first fires, not while
 * this factory runs: the kernel registers hooks before it builds the plugin APIs.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @returns The hook of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "assets:bundle-unloaded": (payload: BundleUnloaded) => void;
} {
  let effects: EffectsCtx | undefined;

  return {
    /**
     * Retires the particle instances and the `Displacement` filters whose textures left, drops
     * their bakes, and lets their keys warn again once the bundle is back.
     *
     * @param payload - The bundle that left and the keys it carried.
     */
    "assets:bundle-unloaded": (payload: BundleUnloaded): void => {
      effects ??= withDeps(ctx);
      retireParticleKeys(effects, payload.keys);
      retireFilterMaps(effects, payload.keys);

      for (const key of payload.keys) effects.state.warned.delete(`texture:${key}`);
    }
  };
}
