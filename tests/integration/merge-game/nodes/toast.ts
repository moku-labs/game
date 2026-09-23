/**
 * @file Transit node `toast`: the sawmill was tapped on a full board. The toast swings in under
 * the HUD and the board is back at once: the node does not wait for the animation, so the toast
 * never blocks the next tap.
 */
import { play, type } from "@moku-labs/game";
import { toastBoardFull } from "../features/board/toast";
import { defineNode } from "../kit";

export const toast = defineNode({
  outcomes: { done: type() },
  run: ({ fx, out }) => {
    void fx(play(toastBoardFull, { under: { projection: "hud", key: "hudRow" } }));

    return out.done();
  }
});
