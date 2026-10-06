/**
 * @file Home as a feature: its scene, its screen, the text styles of the game and the boot bundle
 * `ui`. It also carries the compiled messages of the whole game: the compiler writes one module
 * per locale, so one feature registers them. The English one is bundled, the Russian one is
 * fetched when the player switches.
 */
import enStrings from "../../generated/strings.en";
import { defineFeature } from "../../kit";
import { uiAssets } from "../ui/assets";
import { homeScene } from "./scene";
import { homeStyles } from "./styles";
import { homeScreen } from "./view";

export const homeFeature = defineFeature("home", {
  scenes: [homeScene],
  projections: [homeScreen],
  textStyles: homeStyles,
  assets: uiAssets,
  strings: { en: enStrings, ru: () => import("../../generated/strings.ru") }
});
