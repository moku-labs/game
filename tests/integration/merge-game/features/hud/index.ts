/**
 * @file The HUD as a feature: the two projections of the top bar, the counter component, the
 * coin flight, and the shared interface of the game — the text styles of every screen and the
 * boot bundle `ui` with the fonts, the 9-slice pieces, the icons and the click. A headless test
 * composes `hudFeature.logicOnly` and sees none of it.
 *
 * It also carries the compiled messages of the whole game. The compiler walks every feature's
 * `strings/` folder and writes one module per locale, so one feature registers them; the Russian
 * one is bundled, the English one is fetched when the player switches.
 */
import ruStrings from "../../generated/strings.ru";
import { defineFeature } from "../../kit";
import { uiAssets } from "../ui/assets";
import { uiStyles } from "../ui/styles";
import { coinsFly } from "./animations";
import { Counter, hudCoins } from "./coins";
import { hud } from "./view";

export const hudFeature = defineFeature("hud", {
  projections: [hud, hudCoins],
  components: [Counter],
  animations: [coinsFly],
  textStyles: uiStyles,
  assets: uiAssets,
  strings: { ru: ruStrings, en: () => import("../../generated/strings.en") }
});
