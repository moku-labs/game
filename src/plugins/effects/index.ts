/**
 * Effects plugin — Complex tier.
 *
 * Particles on Pixi's `ParticleContainer` and WGSL filters as flat components, both cosmetic and
 * stepped by world systems. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { animPlugin } from "../anim";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { worldPlugin } from "../world";
import { createEffectsApi } from "./api";
import { createHandlers } from "./handlers";
import { startEffects, stopEffects } from "./lifecycle";
import { createEffectsState } from "./state";
import type { Config } from "./types";

const config: Config = {
  maxParticles: 3000,
  maxPasses: 24,
  phone: "auto",
  blur: { quality: 2, phoneResolution: 0.5 }
};

/**
 * Effects plugin: `app.effects.stats()`; the `Emitter` component and every filter component do
 * the rest as data on entities.
 *
 * @example
 * ```ts
 * // A game composes it next to the screen set; its features bring the emitters and filters.
 * const app = createApp({
 *   plugins: [...screen, effectsPlugin, boardFeature],
 *   pluginConfigs: { renderer: { mount: "#game" }, effects: { maxPasses: 16 } }
 * });
 * app.effects.stats(); // { particles: 0, emitters: 0, filters: 0, renderPasses: 0 }: nothing runs before start
 * ```
 */
export const effectsPlugin = /*#__PURE__*/ createPlugin("effects", {
  depends: [flowPlugin, worldPlugin, rendererPlugin, assetsPlugin, animPlugin],
  config,
  createState: createEffectsState,
  api: createEffectsApi,
  hooks: createHandlers,
  onStart: startEffects,
  // @no-resource-check — onStop destroys the particle containers and the uniform buffers of every filter.
  onStop: ({ state }) => stopEffects(state)
});
