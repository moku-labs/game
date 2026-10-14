/**
 * @file The node factory of the episodes: the first node of each episode's story.
 */
import { defineNode } from "@core/kit";
import type { Episode } from "@core/types";
import { type } from "@moku-labs/game";

/**
 * Builds the first node of an episode's story: a transit node that writes the episode into the
 * session, so the ward scene names that episode's bundle, and goes on at once.
 *
 * @param episode - The episode the node opens.
 * @returns The node, with the one outcome `done`.
 * @example
 * ```ts
 * // features/episodes/ep02/flow/story.ts: the story of episode 2 starts with it.
 * defineFlow("ep02Story", { nodes: { open: openEpisode("ep02") }, start: "open", outcomes: { done: type() }, edges: { open: { done: exit("done") } } });
 * ```
 */
export function openEpisode(episode: Episode) {
  return defineNode({
    outcomes: { done: type() },
    run: ({ session, out }) => {
      session.episode = episode;

      return out.done();
    }
  });
}
