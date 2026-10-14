/**
 * @file Rest node `home`: the checkpoint the Home screen is shown on. It waits for Play, which
 * opens the episodes.
 */
import { defineNode } from "@core/kit";
import { type } from "@moku-labs/game";

export const homeNode = defineNode({
  scene: "home",
  outcomes: { play: type() },
  rest: true,
  checkpoint: true
});
