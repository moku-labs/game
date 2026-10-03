/**
 * @file Transit node `loadFailed`: a bundle the splash waits for did not load. The session says
 * so, and the splash shows its retry line instead of a full bar that never moves on.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const loadFailed = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.loadFailed = true;

    return out.done();
  }
});
