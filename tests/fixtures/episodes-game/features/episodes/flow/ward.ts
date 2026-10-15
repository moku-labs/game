/**
 * @file Rest node `ward`: the checkpoint the room of the current episode is shown on. Its scene
 * belongs to `episodes-kit` and names the episode's bundle from the session.
 */
import { defineNode } from "@core/kit";
import { type } from "@moku-labs/game";

export const wardNode = defineNode({
  scene: "ward",
  outcomes: { leave: type() },
  rest: true,
  checkpoint: true
});
