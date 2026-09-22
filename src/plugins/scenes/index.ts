/**
 * Standard tier — a scene is a declaration a node names: a bundle, layers, projections, music.
 * The switch runs inside `flow.onEnter("scene")`. Emits `scenes:changed`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { worldPlugin } from "../world";
import { createScenesApi } from "./api";
import { startScenes, stopScenes } from "./lifecycle";
import { createScenesState } from "./state";
import type { Events } from "./types";

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
 * ```
 */
export const scenesPlugin = /*#__PURE__*/ createPlugin("scenes", {
  depends: [flowPlugin, worldPlugin, assetsPlugin],
  events: register => register.map<Events>({ "scenes:changed": "The mounted scene changed" }),
  createState: createScenesState,
  api: createScenesApi,
  onStart: startScenes,
  // @no-resource-check — onStop removes the onEnter callback; world.onStop clears the entities.
  onStop: ({ state }) => stopScenes({ state })
});
