/**
 * @file The episodes game as one data object: its main flow, where a new player and a session
 * start, and its two top-level features. `episodes` is a parent: it declares its three
 * sub-features, so this list names the parent only and the shell composes the tree, a parent
 * before its children. The seams (clock, save, manifest, files) come from the caller.
 */
import { startingPlayer, startingSession } from "@core/types";
import { episodesFeature, homeFeature } from "@features";
import type { GameDefinition } from "@moku-labs/game/app";
import { defineGameApp } from "@moku-labs/game/app";
import { mainFlow } from "./game";

/** The game as data: this file hands it to `defineGameApp`; a test adds a probe plugin to it. */
export const episodesDefinition = {
  flow: mainFlow,
  safeNode: "home",
  player: startingPlayer,
  session: startingSession,
  features: [homeFeature, episodesFeature]
} satisfies GameDefinition;

export default defineGameApp(episodesDefinition);
