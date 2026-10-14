/**
 * @file The story of episode 2, `ep02Story`: it opens the episode and ends.
 */
import { defineFlow } from "@core/kit";
import { openEpisode } from "@features/episodes/episodes-kit";
import { exit, type } from "@moku-labs/game";

export const ep02Flow = defineFlow("ep02Story", {
  nodes: { open: openEpisode("ep02") },
  start: "open",
  outcomes: { done: type() },
  edges: { open: { done: exit("done") } }
});
