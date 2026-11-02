/**
 * Very Complex tier — pixels: one Pixi v8 application on one canvas. `host` creates it and
 * survives a lost device, `viewport` maps the window to the reference space, `sync` owns every
 * display object, `kept` draws a still filtered view from a picture, `shots` keeps a small soft
 * picture of the drawn frame under an asset key, `monitor` counts and, in an agent build, measures
 * every frame. Emits
 * `renderer:device-lost`. Hooks `lifecycle:changed` (a pause serves the waiting captures, trims
 * Pixi's texture pool and, in an agent build, flushes the performance log), and in an agent build
 * `flow:edge`, `flow:rest` (the flow path of the frames) and `time:thermal` (the thermal line).
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { clockPlugin } from "../clock";
import { flowPlugin } from "../flow";
import { lifecyclePlugin } from "../lifecycle";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createRendererApi } from "./api";
import { createHandlers } from "./handlers";
import { startRenderer, stopRenderer } from "./lifecycle";
import { createRendererState } from "./state";
import type { Config, Events } from "./types";

const config: Config = {
  mount: undefined,
  background: 0x00_00_00,
  antialias: false,
  maxResolution: 2,
  poolTrim: { restMs: 1000, aboveMb: 16 },
  preference: "webgpu",
  aspect: { min: 4 / 3, max: 21 / 9 },
  poolLimit: 256,
  unsupportedMessage: "This device cannot run the game.",
  loadPixi: () => import("pixi.js"),
  debug: { nineSlice: false, verifyFrames: false, kept: true, overdraw: false },
  monitor: {
    budgetMs: "rate",
    frames: 1024,
    stillFrames: 60,
    stillMpx: 0.25,
    churnPerSecond: 4,
    churnSeconds: 3,
    churnAfterTrimMs: 1000
  },
  onDemand: false,
  keptMb: 64,
  warm: 1,
  uploads: 1,
  adaptiveScale: { floor: 0.75, devices: "phone" },
  shots: undefined
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
  depends: [timePlugin, lifecyclePlugin, clockPlugin, worldPlugin, flowPlugin],
  config,
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "renderer:device-lost": "The GPU device or context was lost; the game is paused"
    }),
  createState: createRendererState,
  api: createRendererApi,
  hooks: createHandlers,
  onStart: startRenderer,
  // @no-resource-check — onStop destroys the Pixi application and runs every cleanup.
  onStop: ({ config, state }) => stopRenderer({ config, state })
});
