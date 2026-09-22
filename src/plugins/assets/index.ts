/**
 * Complex tier — the art of the game: bundles of textures by key, a graph-driven preload and a
 * texture-memory budget. Emits `assets:bundle-progress`, `assets:bundle-loaded`,
 * `assets:bundle-unloaded`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { createAssetsApi } from "./api";
import { createHandlers } from "./handlers";
import { connectAssets, releaseAll, startAssets } from "./lifecycle";
import { createAssetsState } from "./state";
import type { Config, Events } from "./types";

const config: Config = {
  manifest: undefined,
  textureBudgetMb: 192,
  preloadDepth: 2,
  baseUrl: undefined,
  io: undefined
};

/**
 * Assets plugin: `app.assets.load(bundle)`, `app.assets.texture(key)`, `app.assets.usage()`.
 *
 * @example
 * ```ts
 * // A game names its manifest; the graph decides from there what is loaded and when.
 * const app = createApp({
 *   plugins: [...screen, boardFeature],
 *   pluginConfigs: { assets: { manifest: "/assets/manifest.json", textureBudgetMb: 192 } }
 * });
 *
 * await app.start();
 * app.assets.usage().textureMb; // 0.188, the boot tier
 * ```
 */
export const assetsPlugin = /*#__PURE__*/ createPlugin("assets", {
  depends: [flowPlugin, rendererPlugin, timePlugin],
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "assets:bundle-loaded": "Every file of a bundle is a texture now",
      "assets:bundle-progress": "One more file of a running bundle load settled",
      "assets:bundle-unloaded": "The textures of a bundle were destroyed"
    }),
  createState: createAssetsState,
  api: createAssetsApi,
  hooks: createHandlers,
  onInit: connectAssets,
  onStart: startAssets,
  // @no-resource-check — onStop destroys the textures and aborts the loads.
  onStop: ({ state }) => releaseAll(state)
});
