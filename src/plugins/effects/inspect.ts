/**
 * @file effects plugin — the sources of the `/inspect` door: the counts of `stats()` and the
 * filter kinds with the ones a debug switch turned off. Production-safe: they only read.
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

/**
 * The filter kinds of the app, in registration order, and the ones a debug switch turned off.
 * Production-safe: it only reads, and `off` is always `[]` there.
 *
 * @throws {Error} `[game] The source game.filters needs effectsPlugin.` when the app has no `effectsPlugin`.
 * @example
 * ```ts
 * // The editor's tools page after the glow was switched off on the phone.
 * read(app, sources.filters); // { kinds: ["effects.glow", …, "casefile.frost"], off: ["effects.glow"] }
 * ```
 */
export const filtersSource = defineSource({
  id: "game.filters",
  title: "Filter kinds",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly effects?: EffectsApi }) => {
    if (app.effects === undefined) throw notInstalled("game.filters", "effectsPlugin");

    const { diagnostics } = app.effects;

    return { kinds: diagnostics.kinds(), off: diagnostics.disabled() };
  }
});
