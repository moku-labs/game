/**
 * @file audio plugin — the audio command of the `/control` door: mute the whole game. Dev builds
 * only: the body starts with the inline dev guard, so a bundler `define` of `false` drops it, and
 * logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused, notInstalled } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { AudioApi } from "./types";

/**
 * Mutes or unmutes the `master` bus, so music and sfx both go silent; the stored volumes stay.
 * Answers the flag as it is afterwards.
 *
 * @throws {Error} `[game] The command game.mute needs audioPlugin.` when the app has no `audioPlugin`.
 * @example
 * ```ts
 * // The editor's Sound switch silences the game while a level is checked.
 * (await run(app, commands.mute, { muted: true })).value; // true
 * ```
 */
export const muteCommand = defineCommand({
  id: "game.mute",
  title: "Mute",
  input: { muted: "boolean" },
  effect: "cosmetic",
  run: (app: ControlApp & { readonly audio?: AudioApi }, { muted }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
    if (app.audio === undefined) throw notInstalled("game.mute", "audioPlugin", "command");

    app.log.debug("moku:dev", { command: "game.mute", muted });
    app.audio.mute("master", muted);

    return app.audio.muted("master");
  }
});
