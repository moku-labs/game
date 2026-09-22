/**
 * @file The authoring helpers bound to the types of this game, once for the whole game. The asset
 * and bundle keys come from `generated/assets.ts` and the message keys from `generated/strings.ts`,
 * which the scanner writes, so a texture, a bundle or a sentence the game does not have does not
 * compile. The text style names are the one union written by hand: a style is declared in a
 * feature, and a feature imports this file.
 */
import { defineGame } from "@moku-labs/game";
import type { AssetKey, BundleKey } from "./generated/assets";
import type { Strings } from "./generated/strings";
import type { Player, Session } from "./state";

/**
 * Every text style this game draws with: the two the engine brings (`body` and `digits`, built
 * from the fonts of the `text` config) and the ones the features declare with `defineTextStyles`.
 *
 * @example
 * ```ts
 * const style: TextStyleKey = "hud.digits";
 * ```
 */
export type TextStyleKey = "body" | "digits" | "hud.digits" | "hud.label" | "hud.title";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  sprite,
  defineBundles,
  load,
  defineScene,
  defineAnimation,
  tr,
  label,
  defineTextStyles,
  defineComponent,
  defineStyle,
  defineTokens,
  popup,
  music
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "home" | "board";
  strings: Strings;
  textStyles: TextStyleKey;
}>();
