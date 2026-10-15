/**
 * @file What the episodes share, as a sub-feature: the node factory each episode's story starts
 * with, and the ward scene both stories end in. It qualifies as a sub-feature by its `assets/`
 * alone; it has no strings. An episode reaches it by its door alias, never by a relative path.
 */
import { defineFeature } from "@core/kit";
import { wardRoom } from "./views/room";
import { wardScene } from "./views/scene";

export { openEpisode } from "./flow/open";

export const episodesKitFeature = defineFeature("episodes-kit", {
  scenes: [wardScene],
  projections: [wardRoom]
});
