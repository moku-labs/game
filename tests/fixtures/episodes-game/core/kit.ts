/**
 * @file The authoring helpers bound to the types of the episodes game, once. The asset and bundle
 * keys come from `generated/assets.ts` and the message keys from `generated/strings.ts`, which
 * `moku-game keys` writes, so a texture, a bundle or a sentence the game does not have does not
 * compile. The scene ids are the one union written by hand.
 */
import type { AssetKey, BundleKey } from "@generated/assets";
import type { Strings } from "@generated/strings";
import { defineGame } from "@moku-labs/game";
import type { Player, Session } from "./types";

export const { defineNode, defineFlow, defineFeature, projection, defineBundles, defineScene, tr } =
  defineGame<{
    player: Player;
    session: Session;
    assets: AssetKey;
    bundles: BundleKey;
    scenes: "home" | "picker" | "ward";
    strings: Strings;
  }>();
