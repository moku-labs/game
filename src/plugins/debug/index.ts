/**
 * Micro tier — the editor's overlay from the game: `app.debug.overlay`, a no-op without the agent.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createOverlay } from "./overlay";

/**
 * Debug plugin: `app.debug.overlay.open()`, `close()`, `toggle()`, `isOpen()`.
 *
 * @example
 * ```ts
 * app.debug.overlay.open({ mode: "pill" }); // true on a debug build, false on the store build
 * ```
 */
export const debugPlugin = /*#__PURE__*/ createPlugin("debug", {
  api: ctx => ({ overlay: createOverlay(ctx) })
});
