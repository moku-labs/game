/**
 * @file Transit node `select`: a tap on an item of the board (design §6 F9, B4). The item becomes
 * the selected thing: the ring moves to its cell and the info bar names it. It costs nothing and
 * changes no rule state, so the node only writes the session and goes back to the board.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const select = defineNode({
  input: type<{ id: string }>(),
  outcomes: { done: type() },
  run: ({ input, session, out }) => {
    session.selected = input.id;

    return out.done();
  }
});
