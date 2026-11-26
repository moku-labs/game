/**
 * @file The authoring helpers bound to the types of the stress bench, once.
 */
import { defineGame } from "../../src/index.ts";
import type { AssetKey, BundleKey } from "./generated/assets";
import type { Player, Session } from "./state";

/** The bench has no strings: every word on its screen is test content. */
export type Empty = Record<string, never>;

export const {
  defineBundles,
  defineEmitter,
  defineFeature,
  defineFlow,
  defineNode,
  defineScene,
  defineStyle,
  defineTextStyles,
  projection,
  Emitter
} = defineGame<{
  player: Player;
  session: Session;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: "stress";
  strings: Empty;
  textStyles: "body" | "s.title" | "s.name" | "s.pill";
  emitters: "fx.sparkle";
}>();
