/**
 * @file effects plugin — the effects source of the `/inspect` door: the counts of `stats()`.
 * Production-safe: it only reads.
 */
import { defineSource } from "../flow/doors/define";
import { notInstalled } from "../flow/doors/dev";
import type { HeadlessApp } from "../flow/headless";
import type { EffectsApi } from "./types";

/**
 * What the effects draw now: live particles, emitter instances with orphans, filter instances
 * and the render passes of the frame.
 *
 * @throws {Error} `[game] The source game.effects needs effectsPlugin.` when the app has no `effectsPlugin`.
 * @example
 * ```ts
 * // The editor's stats panel while the board rests: one steam stream and the glows of 24 cards.
 * read(app, sources.effects);
 * // { particles: 18, emitters: 1, filters: 24, renderPasses: 49 }
 * ```
 */
export const effectsSource = defineSource({
  id: "game.effects",
  title: "Effects",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly effects?: EffectsApi }) => {
    if (app.effects === undefined) throw notInstalled("game.effects", "effectsPlugin");

    return app.effects.stats();
  }
});
