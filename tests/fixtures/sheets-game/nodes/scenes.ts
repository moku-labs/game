/**
 * @file The two rest nodes the player stands on, the ward and the board, and the transit nodes that walk between
 * them, writing where the player is.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

/** The ward: a checkpoint; its buttons open the sheets and walk to the board. */
export const ward = defineNode({
  scene: "ward",
  rest: true,
  checkpoint: true,
  outcomes: { shop: type(), casefile: type(), inspect: type(), board: type() }
});

/** The board: a checkpoint; the shop opens over it too. */
export const board = defineNode({
  scene: "board",
  rest: true,
  checkpoint: true,
  outcomes: { shop: type(), ward: type() }
});

/** Walks to the board. */
export const toBoard = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.at = "board";

    return out.done();
  }
});

/** Walks back to the ward. */
export const toWard = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.at = "ward";

    return out.done();
  }
});
