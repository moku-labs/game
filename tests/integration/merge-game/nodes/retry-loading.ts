/**
 * @file Transit node `retryLoading`: the player tapped the retry line of the splash. The line
 * goes and the loader shows again; the loading plugin hears this edge and loads the bundles that
 * failed once more.
 */
import { type } from "@moku-labs/game";
import { defineNode } from "../kit";

export const retryLoading = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.loadFailed = false;

    return out.done();
  }
});
