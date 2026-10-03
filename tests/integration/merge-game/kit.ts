/**
 * @file The authoring helpers bound to the types of this game, once for the whole game. The asset
 * and bundle keys come from `generated/assets.ts` and the message keys from `generated/strings.ts`,
 * which the scanner writes, so a texture, a bundle or a sentence the game does not have does not
 * compile. The text style names and the effect ids are the two unions written by hand: a style and
 * an effect are declared in a feature, and a feature imports this file.
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
  | "ui.button-small"
  | "ui.plank"
  | "ui.number"
  | "ui.amount"
  | "ui.tab"
  | "ui.name"
  | "ui.caption"
  | "ui.body"
  | "ui.field"
  | "ui.paragraph"
  | "ui.link"
  | "ui.small"
  | "ui.badge"
  | "ui.badgeInk"
  | "ui.logo"
  | "ui.sign";

/**
 * Every particle effect this game draws, declared with `defineEmitter` in `view/effects.ts`: the
 * stars and the sparkles of a burst, and the steam of the sawmill.
 *
 * @example
 * ```ts
 * const effect: EffectId = "fx.steam";
 * ```
 */
export type EffectId = "fx.stars" | "fx.sparkles" | "fx.steam";

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
  music,
  Frames,
  defineEmitter,
  Emitter
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "splash" | "home" | "board";
  strings: Strings;
  textStyles: TextStyleKey;
  emitters: EffectId;
}>();
