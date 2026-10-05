/**
 * @file effects plugin — the two hooks: a bundle that left takes the effects drawn with its
 * textures along, particles and `Displacement` maps alike, whatever their space; a dev hot swap
 * replaces the registered emitters its module exports.
 */
import { retireFilterMaps } from "./filters/system";
import { isEmitterDefinition, withDeps } from "./lifecycle";
import { retireParticleKeys } from "./particles/system";
import type { BundleUnloaded, EffectsCtx, HotSwap, KernelSlice } from "./types";

/**
 * Replaces every registered emitter the saved module exports and drops its bake, so the next
 * instance bakes the new config; a live instance keeps its own bake. An id no feature registered
 * warns `effects:hot-unknown-emitter`: a new emitter needs a feature, so a reload.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @param module - The new exports of the saved module.
 */
function replaceEmitters(ctx: KernelSlice, module: HotSwap["module"]): void {
  const { state } = ctx;

  for (const entry of Object.values(module)) {
    if (!isEmitterDefinition(entry)) continue;

    if (!state.emitters.has(entry.id)) {
      ctx.log.warn("effects:hot-unknown-emitter", { id: entry.id });
      continue;
    }

    state.emitters.set(entry.id, entry);
    state.baked.delete(entry.id);
  }
}

/**
 * Creates the hook handlers. The domain context is built when a hook that needs the deps first
 * fires, not while this factory runs: the kernel registers hooks before it builds the plugin APIs.
 *
 * @param ctx - Kernel context of the effects plugin.
 * @returns The hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "assets:bundle-unloaded": (payload: BundleUnloaded) => void;
  "ui:hot-swap": (payload: HotSwap) => void;
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
    },
    /**
     * Replaces the registered emitters a dev hot swap brought. Only dev emits it.
     *
     * @param payload - The saved file and its new exports.
     */
    "ui:hot-swap": (payload: HotSwap): void => {
      replaceEmitters(ctx, payload.module);
    }
  };
}
