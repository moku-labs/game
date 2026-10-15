/**
 * @file The story of episode 1, `ep01Story`: it opens the episode and ends. A sibling sub-feature
 * is reached by its door alias.
 */
import { defineFlow } from "@core/kit";
import { openEpisode } from "@features/episodes/episodes-kit";
import { exit, type } from "@moku-labs/game";

export const ep01Flow = defineFlow("ep01Story", {
  nodes: { open: openEpisode("ep01") },
  start: "open",
  outcomes: { done: type() },
  edges: { open: { done: exit("done") } }
});
