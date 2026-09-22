/**
 * @file The authoring helpers bound to the types of this game, once for the whole game. The asset
 * and bundle keys come from `generated/assets.ts`, which the scanner writes, so a texture or a
 * bundle the game does not have does not compile.
 */
import { defineGame } from "@moku-labs/game";
import type { AssetKey, BundleKey } from "./generated/assets";
import type { Player, Session } from "./state";

export const {
  defineNode,
  defineFlow,
  defineFeature,
  projection,
  sprite,
  defineBundles,
  load,
  defineScene
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "home" | "board";
  strings: Record<string, unknown>;
}>();
