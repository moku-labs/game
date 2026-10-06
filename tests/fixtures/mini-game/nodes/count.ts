/**
 * @file Transit node `count`: the player said OK, so the counter of the save goes up by one.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const count = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.count += 1;

    return out.done();
  }
});
