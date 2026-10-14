/**
 * @file The ward scene: the shared bundle of the episodes, and the bundle of the episode the
 * session names, read from the committed state each time a node enters the scene. Every way in
 * (an entry, a restore, the safe node) waits for both before the ward's gate opens.
 */
import { defineScene } from "@core/kit";
import { wardRoom } from "./room";

export const wardScene = defineScene("ward", {
  bundle: "episodes-kit",
  bundles: ({ session }) => [session.episode],
  layers: {},
  projections: [wardRoom]
});
