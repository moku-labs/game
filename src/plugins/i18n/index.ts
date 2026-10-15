/**
 * Complex tier — messages as data, compiled ICU at build time, parts at run time. When `assets`
 * is composed, `onInit` hands it a companion, so the lazy strings of a sub-feature load and unload
 * with the bundle named like it; `depends` stays `flow`.
 * Emits `i18n:locale-changed`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { flowPlugin } from "../flow";
import { createI18nApi } from "./api";
import { connectI18n } from "./bundles";
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
 *
 * // A sub-feature registers its own modules lazily: they arrive with the bundle "ep01".
 * export const ep01Feature = defineFeature("ep01", {
 *   strings: { en: () => import("@generated/strings.ep01.en") }
 * });
 * await app.assets.load("ep01"); // resolves after strings.ep01 of the loaded locales arrived
 * ```
 */
export const i18nPlugin = /*#__PURE__*/ createPlugin("i18n", {
  depends: [flowPlugin],
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "i18n:locale-changed":
        "The current locale changed, its messages were replaced, or the strings of a bundle arrived for a key shown missing"
    }),
  config,
  createState: createI18nState,
  api: createI18nApi,
  onInit: connectI18n,
  onStart: startI18n
});
