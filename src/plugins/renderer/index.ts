/**
 * Very Complex tier — pixels: one Pixi v8 application on one canvas. `host` creates it and
 * survives a lost device, `viewport` maps the window to the reference space, `sync` owns every
 * display object. Emits `renderer:device-lost`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { lifecyclePlugin } from "../lifecycle";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createRendererApi } from "./api";
import { startRenderer, stopRenderer } from "./lifecycle";
import { createRendererState } from "./state";
import type { Config, Events } from "./types";

const config: Config = {
  mount: undefined,
  background: 0x00_00_00,
  antialias: false,
  maxResolution: 2,
  preference: "webgpu",
  aspect: { min: 4 / 3, max: 21 / 9 },
  poolLimit: 256,
  unsupportedMessage: "This device cannot run the game.",
  loadPixi: () => import("pixi.js")
};

/**
 * Renderer plugin: `app.renderer.host.ready()`, `app.renderer.viewport.size()`,
 * `app.renderer.sync.hitTest(...)`.
 *
 * @example
 * ```ts
 * // A game with a screen names the element the canvas goes into. Nothing else is configured.
 * const app = createApp({
 *   plugins: [...screen, boardFeature],
 *   pluginConfigs: { renderer: { mount: "#game" } }
 * });
 *
 * await app.start();
 * app.renderer.host.kind(); // "webgpu" in Chrome, "webgl" on an older device
 * ```
 */
export const rendererPlugin = /*#__PURE__*/ createPlugin("renderer", {
  depends: [timePlugin, lifecyclePlugin, worldPlugin],
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "renderer:device-lost": "The GPU device or context was lost; the game is paused"
    }),
  createState: createRendererState,
  api: createRendererApi,
  onStart: startRenderer,
  // @no-resource-check — onStop destroys the Pixi application and runs every cleanup.
  onStop: ({ config, state }) => stopRenderer({ config, state })
});
