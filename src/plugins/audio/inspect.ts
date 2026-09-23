/**
 * @file audio plugin — the audio source of the `/inspect` door: the journal of started sounds.
 * Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { AudioApi } from "./types";

/**
 * The sounds that started, oldest first: every sfx played and every music track begun, all of
 * them or the last few. Empty unless `pluginConfigs.audio.journal` is above 0.
 *
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
  read: (app: HeadlessApp & { readonly audio: AudioApi }, { last }) => {
    const entries = app.audio.journal();

    return last === undefined ? entries : entries.slice(Math.max(0, entries.length - last));
  }
});
