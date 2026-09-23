/**
 * @file The loading plugin of the splash. A node cannot hear an engine event and a plugin cannot
 * commit, so the work is split the way the clock does it: this plugin listens to
 * `assets:bundle-progress` and `assets:bundle-loaded` for the three bundles Home and the board
 * need, and posts world events into the flow inbox; the `splash` rest node takes them. `progress`
 * carries the share, which the `setLoading` node commits to `session.loading` for the loading bar;
 * `loaded` goes out once, when the last of the three is loaded.
 *
 * `loaded` follows `assets:bundle-loaded` and never `loaded === total`: a failed file counts as
 * settled in the progress, so the count can reach the total for a bundle that did not load.
 */
import type { Assets } from "@moku-labs/game";
import { assetsPlugin, createPlugin, flowPlugin } from "@moku-labs/game";
import type { LoadingState } from "./loading";
import {
  createLoadingState,
  isComplete,
  isWatched,
  recordLoaded,
  recordProgress,
  shareOf,
  watchedBundles
} from "./loading";

/** What the plugin needs to post: the inbox of the flow. */
type Inbox = { post(event: { type: string; payload?: { share: number } }): void };

/**
 * Posts the share when it moved, and `loaded` once when every bundle is in.
 *
 * @param state - The loading state.
 * @param inbox - The flow inbox.
 */
function report(state: LoadingState, inbox: Inbox): void {
  if (state.posted) return;

  const share = shareOf(state);

  if (share !== state.reported) {
    state.reported = share;
    inbox.post({ type: "progress", payload: { share } });
  }

  if (!isComplete(state)) return;

  state.posted = true;
  inbox.post({ type: "loaded" });
}

/**
 * Loads the three bundles of the splash and reports how far they came. `onStart` asks `assets`
 * for each one, so the board bundle, which belongs to a scene, is not left to the preload; a
 * bundle that is already in (the headless game reads the manifest only) counts at once.
 */
export const loadingPlugin = createPlugin("loading", {
  depends: [flowPlugin, assetsPlugin],
  createState: createLoadingState,
  hooks: ctx => ({
    "assets:bundle-progress": (payload: Assets.Events["assets:bundle-progress"]) => {
      if (!isWatched(payload.bundle) || payload.total === 0) return;

      recordProgress(ctx.state, payload.bundle, payload.loaded / payload.total);
      report(ctx.state, ctx.require(flowPlugin).inbox);
    },
    "assets:bundle-loaded": (payload: Assets.Events["assets:bundle-loaded"]) => {
      if (!isWatched(payload.bundle)) return;

      recordLoaded(ctx.state, payload.bundle);
      report(ctx.state, ctx.require(flowPlugin).inbox);
    }
  }),
  onStart: ctx => {
    const assets = ctx.require(assetsPlugin);

    for (const bundle of watchedBundles) {
      if (assets.isLoaded(bundle)) {
        recordLoaded(ctx.state, bundle);
        continue;
      }

      assets.load(bundle).catch((error: unknown) => {
        ctx.log.error(
          "merge-game: a bundle of the splash failed",
          { bundle },
          error instanceof Error ? error : new Error(String(error))
        );
      });
    }

    report(ctx.state, ctx.require(flowPlugin).inbox);
  }
});
