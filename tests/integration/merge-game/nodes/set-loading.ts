/**
 * @file Transit node `setLoading`: the loading plugin posted a new share. It is written into the
 * session, the tree the loading bar of the splash reads, and the graph goes back to the splash.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";
import type { LoadingInput } from "./splash";

export const setLoading = defineNode({
  input: type<LoadingInput>(),
  outcomes: { done: type() },
  run: ({ input, session, out }) => {
    session.loading = Math.min(1, Math.max(0, input.share));

    return out.done();
  }
});
