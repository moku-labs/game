/**
 * @file Transit node `grant`: the player took the reward. The coins were paid where they were
 * earned, so only the record of the claim is written here.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const grant = defineNode({
  outcomes: { done: type() },
  run: ({ player, session, out }) => {
    player.claimed.push(session.pendingReward);
    session.pendingReward = "";

    return out.done();
  }
});
