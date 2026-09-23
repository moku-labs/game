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
 * from the fonts of the `text` config) and the ones `features/ui/styles.ts` declares with
 * `defineTextStyles`.
 *
 * @example
 * ```ts
 * const style: TextStyleKey = "ui.title";
 * ```
 */
export type TextStyleKey =
  | "body"
  | "digits"
  | "ui.title"
  | "ui.button"
  | "ui.number"
  | "ui.name"
  | "ui.body"
  | "ui.small"
  | "ui.badge"
  | "hud.digits"
  | "hud.label"
  | "hud.title";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  sprite,
  Sprite,
  NineSlice,
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
  scenes: "splash" | "home" | "board";
  strings: Strings;
  textStyles: TextStyleKey;
}>();
