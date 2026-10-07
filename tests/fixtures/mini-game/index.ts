/**
 * @file The mini game as one data object: its main flow, where a new player and a session start,
 * and its two features. `game.screen()` composes the engine's screen set and the features;
 * `game.headless()` the logic of the info feature only. The seams (clock, save, manifest, platform)
 * come from the caller: a test, or the page.
 */
import { defineGameApp } from "@moku-labs/game/app";
import { homeFeature } from "./features/home";
import { infoFeature } from "./features/info";
import { mainFlow } from "./flows/main";
import { startingPlayer, startingSession } from "./state";

export default defineGameApp({
  flow: mainFlow,
  safeNode: "home",
  player: startingPlayer,
  session: startingSession,
  features: [homeFeature, infoFeature],
  headless: { features: [infoFeature] }
});
