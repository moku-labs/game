/**
 * @file The root flow `main`: the Home checkpoint, and the episodes as the sub-flow of their
 * parent feature. Play opens the episodes; their `back` comes home.
 */
import { defineFlow } from "@core/kit";
import { episodesFlow, homeNode } from "@features";

export const mainFlow = defineFlow("main", {
  nodes: { home: homeNode, episodes: episodesFlow },
  start: "home",
  edges: { home: { play: "episodes" }, episodes: { back: "home" } }
});
