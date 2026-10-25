/**
 * Standard tier — a scene is a declaration a node names: a bundle, the bundles of state it
 * names with `bundles`, layers, projections, music. The switch runs inside
 * `flow.onEnter("scene")` and mounts a scene once all its bundles are in; a live switch with a
 * drawing renderer builds it aside under `buildMs` a frame and swaps it in one frame. Emits
 * `scenes:changed`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { modelPlugin } from "../model";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createScenesApi } from "./api";
import { checkConfig, startScenes, stopScenes } from "./lifecycle";
import { createScenesState } from "./state";
import type { Config, Events } from "./types";

/** The budget of a live switch: about half a 120 Hz frame. Typed, so a game's number overrides it. */
const defaultConfig: Config = { buildMs: 4 };

/**
 * Scenes plugin: `app.scenes.current()`, and `defineScene` for the game.
 *
 * @example
 * ```ts
 * // features/board/view/scene.ts, and the node that shows it.
 * export const boardScene = defineScene("board", {
 *   bundle: "board",
 *   layers: { cells: {}, items: { sort: "y" }, lifted: {} },
 *   projections: [boardCells, boardItems]
 * });
 *
 * export const awaitIntent = defineNode({ scene: "board", rest: true, outcomes: { merge: type() } });
 *
 * // A scene whose art depends on the session: mounted once "location" and the episode are in.
 * export const wardScene = defineScene("ward", {
 *   bundle: "location",
 *   bundles: ({ session }) => [session.episode],
 *   layers: { room: {} },
 *   projections: [wardRoom]
 * });
 *
 * // A game gives the next scene 3 ms of each frame while the old one stays on the screen.
 * createApp({ plugins: [...screen, boardFeature], pluginConfigs: { scenes: { buildMs: 3 } } });
 * ```
 */
export const scenesPlugin = /*#__PURE__*/ createPlugin("scenes", {
  depends: [flowPlugin, worldPlugin, assetsPlugin, timePlugin, modelPlugin, rendererPlugin],
  config: defaultConfig,
  events: (register: RegisterFunction) =>
    register.map<Events>({ "scenes:changed": "The mounted scene changed" }),
  createState: createScenesState,
  api: createScenesApi,
  onInit: ({ config }) => checkConfig(config),
  onStart: startScenes,
  // @no-resource-check — onStop removes the onEnter callback; world.onStop clears the entities.
  onStop: ({ state }) => stopScenes({ state })
});
