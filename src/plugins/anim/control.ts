/**
 * @file anim plugin — the anim command of the `/control` door: switch reduced motion. Dev builds
 * only: the body starts with the inline dev guard, so a bundler `define` of `false` drops it, and
 * logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { AnimApi } from "./types";

/**
 * Switches reduced motion on or off, the way the player's "Less motion" setting does. Answers
 * the switch as it is afterwards.
 *
 * @example
 * ```ts
 * // Check the popups of the settings screen with no motion at all.
 * (await run(app, commands.reducedMotion, { on: true })).value; // true
 * ```
 */
export const reducedMotionCommand = defineCommand({
  id: "game.reducedMotion",
  title: "Reduced motion",
  input: { on: "boolean" },
  effect: "cosmetic",
  run: (app: ControlApp & { readonly anim: AnimApi }, { on }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.reducedMotion", on });
    app.anim.setReducedMotion(on);

    return app.anim.reducedMotion();
  }
});
