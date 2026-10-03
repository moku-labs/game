/**
 * @file Rest node `splash`: the game waits here while Home and the board load. A pure wait, no
 * body. Three world events arrive through the inbox, all posted by the loading plugin: `progress`
 * with the share the loading bar shows, `loaded` once the three bundles are in, and `failed` when
 * one of them did not load. After a failure the splash shows its retry line, and a tap on it
 * answers `retry`. A game without the screen has no plugin to post them, so a test answers
 * `loaded` through the gate instead.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

/** What a `progress` event carries: how far the loading has come, 0..1. */
export type LoadingInput = { share: number };

export const splash = defineNode({
  scene: "splash",
  outcomes: { progress: type<LoadingInput>(), loaded: type(), failed: type(), retry: type() },
  rest: true,
  inbox: ["progress", "loaded", "failed"]
});
