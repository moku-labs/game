/**
 * @file The HUD as a feature: the two projections of the top bar, the counter component, the
 * coin flight, the text styles and the boot bundle with the fonts and the click. A headless test
 * composes `hudFeature.logicOnly` and sees none of it.
 *
 * It also carries the compiled messages of the whole game. The compiler walks every feature's
 * `strings/` folder and writes one module per locale, so one feature registers them; the Russian
 * one is bundled, the English one is fetched when the player switches.
 */
import ruStrings from "../../generated/strings.ru";
import { defineFeature } from "../../kit";
import { uiAssets } from "../ui/assets";
import { coinsFly } from "./animations";
import { Counter, hudCoins } from "./coins";
import { hudStyles } from "./styles";
import { hud } from "./view";

export const hudFeature = defineFeature("hud", {
  projections: [hud, hudCoins],
  components: [Counter],
  animations: [coinsFly],
  textStyles: hudStyles,
  assets: uiAssets,
  strings: { ru: ruStrings, en: () => import("../../generated/strings.en") }
});
