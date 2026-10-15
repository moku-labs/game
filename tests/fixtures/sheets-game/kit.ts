/**
 * @file The authoring helpers bound to the types of the sheets game, once. The asset and bundle keys come from
 * `generated/assets.ts`; the game has no message (every word it draws is a number), so its string table is empty.
 * The text style, the scene ids and the HUD part keys are written by hand, so a HUD key the game does not have does
 * not compile.
 */
import { defineGame } from "@moku-labs/game";
import type { AssetKey, BundleKey } from "./generated/assets";
import type { Player, Session } from "./state";

/**
 * The one text style of the game: the counters.
 *
 * @example
 * ```ts
 * const style: TextStyleKey = "ui.count";
 * ```
 */
export type TextStyleKey = "body" | "digits" | "ui.count";

/**
 * The parts of the HUD an overlay keeps shown or lets fade.
 *
 * @example
 * ```ts
 * const part: HudKey = "energy";
 * ```
 */
export type HudKey = "level" | "energy" | "gems" | "shop";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  defineBundles,
  defineScene,
  defineTextStyles,
  defineStyle,
  Overlay,
  HudPart
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "ward" | "board";
  strings: Record<string, never>;
  textStyles: TextStyleKey;
  hud: HudKey;
}>();
