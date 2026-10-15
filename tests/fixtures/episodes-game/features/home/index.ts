/**
 * @file Home as a flat feature: its scene and its screen. It also registers the compiled strings
 * of the whole game, as the mini game's Home does: `moku-game keys` writes one module per locale
 * for the keys of the top-level features. English is bundled, Russian is fetched when the player
 * switches. The strings of a sub-feature are not in them: each sub-feature registers its own.
 */
import { defineFeature } from "@core/kit";
import enStrings from "@generated/strings.en";
import { homeScene } from "./views/scene";
import { homeScreen } from "./views/screen";

export { homeNode } from "./flow/home";

export const homeFeature = defineFeature("home", {
  scenes: [homeScene],
  projections: [homeScreen],
  strings: { en: enStrings, ru: () => import("@generated/strings.ru") }
});
