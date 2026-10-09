/**
 * @file effects plugin — the three hooks: a bundle that left takes the effects drawn with its
 * textures along, particles and `Displacement` maps alike, whatever their space; so do the files
 * a dev hot swap replaced, whose effects are built again from the new textures; a dev hot swap of
 * a module replaces the registered emitters it exports.
 */
import { retireFilterMaps } from "./filters/system";
import { isEmitterDefinition, withDeps } from "./lifecycle";
import { retireParticleKeys } from "./particles/system";
import type { AssetsReplaced, BundleUnloaded, EffectsCtx, HotSwap, KernelSlice } from "./types";

/**
 * Retires everything drawn with the textures of `keys`: the particle instances and their bakes,
 * the `Displacement` filters, and the one-shot warning of each key, so it can warn again. The
 * next frame builds each effect again from the texture its key answers then.
 *
 * @param effects - Domain context of the effects plugin.
 * @param keys - The asset keys whose textures are gone.
 */
function retireKeys(effects: EffectsCtx, keys: readonly string[]): void {
  retireParticleKeys(effects, keys);
  retireFilterMaps(effects, keys);

  for (const key of keys) effects.state.warned.delete(`texture:${key}`);
}

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
  "assets:replaced": (payload: AssetsReplaced) => void;
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
      retireKeys(effects, payload.keys);
    },
    /**
     * Retires the particle instances and the `Displacement` filters drawn with the textures a dev
     * hot swap replaced and drops their bakes. The old textures are destroyed and the new ones
     * stand under the same keys, so the next frame builds each effect again from the new one.
     * Only dev emits it.
     *
     * @param payload - The bundle and the keys with new bytes.
     */
    "assets:replaced": (payload: AssetsReplaced): void => {
      effects ??= withDeps(ctx);
      retireKeys(effects, payload.keys);
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
