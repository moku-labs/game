/**
 * @file renderer plugin — the renderer commands of the `/control` door: take a picture of the
 * canvas and switch the debug drawing. Dev builds only: every body starts with the inline dev
 * guard, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Api } from "./types";

/** What the renderer commands need of an app: the control app plus the renderer. */
type RendererApp = ControlApp & { readonly renderer: Api };

/**
 * A PNG of the whole canvas taken at the end of the next drawn frame, as a data URL.
 * `undefined` while the renderer is inert, as in a headless test.
 *
 * @example
 * ```ts
 * // The editor attaches the screen to a bug report.
 * (await run(app, commands.capture)).value; // "data:image/png;base64,iVBORw0KGgo…"
 * ```
 */
export const captureCommand = defineCommand({
  id: "game.capture",
  title: "Capture",
  input: {},
  effect: "read",
  run: (app: RendererApp) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.capture" });

    return app.renderer.capture();
  }
});

/**
 * Switches the debug drawing: `nineSlice` outlines every nine-slice and the lines Pixi cuts its
 * texture at. Answers the switches as they are afterwards.
 *
 * @example
 * ```ts
 * // Check where the settings popup cuts its parchment.
 * (await run(app, commands.debug, { nineSlice: true })).value; // { nineSlice: true }
 * ```
 */
export const debugCommand = defineCommand({
  id: "game.debug",
  title: "Debug drawing",
  input: { nineSlice: "boolean" },
  effect: "cosmetic",
  run: (app: RendererApp, { nineSlice }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.debug", nineSlice });
    app.renderer.sync.debug.nineSlice(nineSlice);

    return app.renderer.sync.debug.state();
  }
});
