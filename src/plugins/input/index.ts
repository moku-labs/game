/**
 * Standard tier — the finger of the game: gestures are data components, one Answer per gesture
 * goes to `flow.gate`. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createInputApi } from "./api";
import { initInput, startInput, stopInput } from "./lifecycle";
import { createInputState } from "./state";
import type { Config } from "./types";

const config: Config = {
  tapSlopPx: 12,
  longPressMs: 450,
  dragStartPx: 8,
  swipeMinPx: 48,
  swipeMaxMs: 300,
  heldScale: 1
};

/**
 * Input plugin: `app.input.tap(target)`, `app.input.drag(from, to)`.
 *
 * @example
 * ```ts
 * // A view declares its behaviour; the engine owns the drag and the way home.
 * const boardItems = projection({
 *   name: "board.items",
 *   layer: "items",
 *   from: (player: Player) => player.items,
 *   key: (item: Item) => item.id,
 *   view: (item: Item) => [
 *     Draggable({ payload: { from: item.cell } }),
 *     DropTarget({ intent: "merge", payload: { to: item.cell } })
 *   ]
 * });
 * ```
 */
export const inputPlugin = /*#__PURE__*/ createPlugin("input", {
  depends: [timePlugin, flowPlugin, worldPlugin, rendererPlugin],
  config,
  createState: createInputState,
  api: createInputApi,
  onInit: initInput,
  onStart: startInput,
  // @no-resource-check — onStop removes the pointer listeners and the frame callback.
  onStop: ({ state }) => stopInput(state)
});
