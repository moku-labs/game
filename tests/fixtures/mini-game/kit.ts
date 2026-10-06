/**
 * @file The authoring helpers bound to the types of the mini game, once. The asset and bundle keys
 * come from `generated/assets.ts` and the message keys from `generated/strings.ts`, which the
 * scanner writes, so a texture or a sentence the game does not have does not compile. The text
 * styles and the emitter ids are the two unions written by hand.
 */
import { defineGame } from "@moku-labs/game";
import type { AssetKey, BundleKey } from "./generated/assets";
import type { Strings } from "./generated/strings";
import type { Player, Session } from "./state";

/**
 * Every text style the game draws with: the two the engine brings and the two of
 * `features/home/styles.ts`.
 *
 * @example
 * ```ts
 * const style: TextStyleKey = "ui.counter";
 * ```
 */
export type TextStyleKey = "body" | "digits" | "ui.counter" | "ui.note";

/**
 * The one particle effect of the game, declared in `features/info/effects.ts`.
 *
 * @example
 * ```ts
 * const effect: EffectId = "fx.spark";
 * ```
 */
export type EffectId = "fx.spark";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  defineBundles,
  defineScene,
  defineAnimation,
  tr,
  defineTextStyles,
  defineComponent,
  defineStyle,
  popup,
  defineEmitter,
  Emitter
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "home";
  strings: Strings;
  textStyles: TextStyleKey;
  emitters: EffectId;
}>();
