/**
 * Complex tier — messages as data, compiled ICU at build time, parts at run time.
 * Emits `i18n:locale-changed`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { createI18nApi } from "./api";
import { startI18n } from "./lifecycle";
import { createI18nState } from "./state";
import type { Config, Events } from "./types";

const config: Config = { locale: "en", fallback: "en", locales: {} };

/**
 * I18n plugin: `app.i18n.format(tr("hud.orders", { n: 3 }))`, and `tr` for the game.
 *
 * @example
 * ```ts
 * // A feature ships its compiled modules; the settings screen switches between them.
 * export const hudFeature = defineFeature("hud", {
 *   projections: [hud],
 *   strings: { ru: ruStrings, en: () => import("./generated/strings.en") }
 * });
 *
 * await app.i18n.setLocale("en"); // text re-resolves every message on i18n:locale-changed
 * ```
 */
export const i18nPlugin = /*#__PURE__*/ createPlugin("i18n", {
  depends: [flowPlugin],
  events: register =>
    register.map<Events>({
      "i18n:locale-changed": "The current locale changed and its messages are loaded"
    }),
  config,
  createState: createI18nState,
  api: createI18nApi,
  onStart: startI18n
});
