/**
 * @file The authoring helpers bound to the types of this game, once for the whole game.
 */
import { defineGame } from "@moku-labs/game";
import type { Player, Session } from "./state";

export const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();
