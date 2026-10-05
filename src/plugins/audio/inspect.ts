/**
 * @file audio plugin — the audio sources of the `/inspect` door: the journal of started sounds
 * and the mute flag of the master bus. Production-safe: they only read.
 */
import { defineSource } from "../flow/doors/define";
import { notInstalled } from "../flow/doors/dev";
import type { HeadlessApp } from "../flow/headless";
import type { AudioApi } from "./types";

/**
 * The sounds that started, oldest first: every sfx played and every music track begun, all of
 * them or the last few. Empty unless `pluginConfigs.audio.journal` is above 0.
 *
 * @throws {Error} `[game] The source game.sounds needs audioPlugin.` when the app has no `audioPlugin`.
 * @example
 * ```ts
 * // After a tap on Deliver, on the dev page that sets `journal: 200`.
 * read(app, sources.sounds, { last: 2 });
 * // [{ key: "ui.click", bus: "sfx", kind: "sfx", at: 1584 }, { key: "orders.complete", bus: "sfx", kind: "sfx", at: 1600 }]
 * ```
 */
export const soundsSource = defineSource({
  id: "game.sounds",
  title: "Sounds",
  input: { last: "number?" },
  changes: "frame",
  read: (app: HeadlessApp & { readonly audio?: AudioApi }, { last }) => {
    if (app.audio === undefined) throw notInstalled("game.sounds", "audioPlugin");

    const entries = app.audio.journal();

    return last === undefined ? entries : entries.slice(Math.max(0, entries.length - last));
  }
});

/**
 * Whether the whole game is muted: the mute flag of the `master` bus. The `game.mute` command
 * writes it.
 *
 * @throws {Error} `[game] The source game.audioMuted needs audioPlugin.` when the app has no `audioPlugin`.
 * @example
 * ```ts
 * // The editor muted the game, and an e2e script checks the switch took.
 * await run(app, commands.mute, { muted: true });
 * read(app, sources.audioMuted); // true
 * ```
 */
export const audioMutedSource = defineSource({
  id: "game.audioMuted",
  title: "Audio muted",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly audio?: AudioApi }) => {
    if (app.audio === undefined) throw notInstalled("game.audioMuted", "audioPlugin");

    return app.audio.muted("master");
  }
});
