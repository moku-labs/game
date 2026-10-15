/**
 * @file The flow of the episodes, `episodesPick`: the picker, the story of each episode, and the
 * ward both stories end in. The ward is a node of this flow, so a restore at `episodes/ward` runs
 * no node of an episode: only the ward scene's `bundles` brings the episode's art. The parent
 * reaches each child's door by a relative path.
 */
import { defineFlow } from "@core/kit";
import { exit, type } from "@moku-labs/game";
import { ep01Flow } from "../ep01";
import { ep02Flow } from "../ep02";
import { pickNode } from "./pick";
import { wardNode } from "./ward";

export const episodesFlow = defineFlow("episodesPick", {
  nodes: { pick: pickNode, ep01: ep01Flow, ep02: ep02Flow, ward: wardNode },
  start: "pick",
  outcomes: { back: type() },
  edges: {
    pick: { ep01: "ep01", ep02: "ep02", back: exit("back") },
    ep01: { done: "ward" },
    ep02: { done: "ward" },
    ward: { leave: "pick" }
  }
});
