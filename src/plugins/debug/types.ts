/**
 * @file debug plugin — type definitions: the overlay call.
 */

/**
 * The two visible modes of the editor's overlay: the small pill or the full card.
 */
export type OverlayMode = "pill" | "card";

/**
 * The editor's overlay, from the game: open it, close it, toggle it, ask whether it shows. Every call is a no-op that
 * answers `false` on a page without the agent (a release build, a test): no import of the editor, no guard needed.
 */
export type OverlayApi = {
  /**
   * Shows the overlay: the card, or the pill with `{ mode: "pill" }`.
   *
   * @param options - How the overlay shows.
   * @param options.mode - `"card"` (the default) or `"pill"`.
   * @returns True when an overlay took the call; false on a page without the agent.
   * @example
   * ```ts
   * // A game's own "?" button of its settings sheet opens the overlay of a debug build.
   * app.debug.overlay.open(); // true on `moku-game build --debug`; false on the store build
   * app.debug.overlay.open({ mode: "pill" }); // true: the small pill
   * ```
   */
  open(options?: { mode?: OverlayMode }): boolean;
  /**
   * Hides the overlay.
   *
   * @returns True when an overlay took the call; false without the agent.
   * @example
   * ```ts
   * app.debug.overlay.close(); // true; app.debug.overlay.isOpen() is false after it
   * ```
   */
  close(): boolean;
  /**
   * Switches between hidden and the last visible mode.
   *
   * @returns True when an overlay took the call; false without the agent.
   * @example
   * ```ts
   * // A game binds a three-finger tap of its own to the overlay.
   * app.debug.overlay.toggle(); // true: shown (the card, or the pill if the pill was the last mode)
   * ```
   */
  toggle(): boolean;
  /**
   * Tells whether the overlay shows, as the pill or the card.
   *
   * @returns True while it shows; false when hidden and without the agent.
   * @example
   * ```ts
   * app.debug.overlay.open({ mode: "pill" });
   * app.debug.overlay.isOpen(); // true
   * ```
   */
  isOpen(): boolean;
};

/**
 * The `debug` plugin's API: the overlay call.
 */
export type Api = {
  /**
   * The editor's overlay. Usable anywhere the app is; a no-op without the agent. The ui tag `DebugTrigger` is one
   * helper on top of it.
   *
   * @example
   * ```ts
   * // ui's DebugTrigger, after five taps:
   * ctx.require(debugPlugin).overlay.open(); // true on a debug build
   * ```
   */
  overlay: OverlayApi;
};
