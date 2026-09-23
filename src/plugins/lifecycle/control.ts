/**
 * @file lifecycle plugin — the lifecycle commands of the `/control` door: pause and resume the
 * game for the editor, through the `devtools` pause reason, so another reason keeps its hold.
 * Dev builds only: every body starts with the inline dev guard, so a bundler `define` of `false`
 * drops it, and logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Api } from "./types";

/** What the lifecycle commands need of an app: the control app plus the lifecycle. */
type LifecycleApp = ControlApp & { readonly lifecycle: Api };

/**
 * Pauses the game with the pause reason `devtools`. Answers whether the game is paused.
 *
 * @example
 * ```ts
 * // The editor's pause button: the world stands, and `game.step` moves it frame by frame.
 * (await run(app, commands.pause)).value; // true
 * app.lifecycle.reasons(); // ["devtools"]
 * ```
 */
export const pauseCommand = defineCommand({
  id: "game.pause",
  title: "Pause",
  input: {},
  effect: "cosmetic",
  run: (app: LifecycleApp) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.pause" });
    app.lifecycle.push("devtools");

    return app.lifecycle.isPaused();
  }
});

/**
 * Takes the pause reason `devtools` back. Answers whether the game is still paused: another
 * reason, such as a hidden tab, keeps its hold.
 *
 * @example
 * ```ts
 * // The editor's play button while the tab is visible.
 * (await run(app, commands.resume)).value; // false: the game runs again
 * ```
 */
export const resumeCommand = defineCommand({
  id: "game.resume",
  title: "Resume",
  input: {},
  effect: "cosmetic",
  run: (app: LifecycleApp) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.resume" });
    app.lifecycle.pop("devtools");

    return app.lifecycle.isPaused();
  }
});
