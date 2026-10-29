/**
 * @file assets plugin — event handlers: the rest node that settles the memory and marks the
 * release of the bundles a left feature brought, and the dev hot swap that replaces the asset
 * files a save changed.
 */
import { enforceBudget } from "./budget";
import { withDeps } from "./lifecycle";
import { startPreload } from "./preload";
import { createSwap } from "./swap";
import type { AssetsCtx, FlowRest, HotSwap, KernelSlice } from "./types";

/**
 * Creates the hook handlers. `flow:rest` is the one moment the graph stands still, so it is where
 * the memory is settled and the neighbourhood of the position is queued. The loading itself is a
 * background queue in the state and is never awaited here: an engine hook is synchronous. A live
 * rest only marks the release of the `"leave"` bundles: it fires before the arriving node's `load`
 * stage, whose bundles are not pinned yet, so that stage runs the release. The
 * global `ui:hot-swap` is hooked with no `depends` on `ui`, as `effects` does: in a dev build it
 * brings the stamp of the keys watch, and the changed files are replaced behind it.
 *
 * A handler builds its domain context when it first fires, not while this factory runs: the
 * kernel registers hooks before it builds the plugin APIs, so nothing is resolvable yet.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @param reload - What a refused or a broken hot swap calls. The kernel passes nothing, which
 *   means the page reload; a test passes a spy.
 * @returns The two hooks of the plugin.
 */
export function createHandlers(
  ctx: KernelSlice,
  reload?: () => void
): {
  "flow:rest": (payload: FlowRest) => void;
  "ui:hot-swap": (payload: HotSwap) => void;
} {
  let assets: AssetsCtx | undefined;
  let swap: ((payload: HotSwap) => void) | undefined;

  return {
    /**
     * Marks the release of a live rest, settles the texture memory and rebuilds the background
     * preload.
     *
     * @param _payload - Where the graph rests. The position itself comes from the state.
     */
    "flow:rest": (_payload: FlowRest): void => {
      assets ??= withDeps(ctx);

      if (assets.state.io === undefined) return;

      // A fast walk shows the rests it passes to nobody: nothing is released or preloaded there.
      const live = assets.deps.flow.state().mode !== "fast";

      // The release waits for the arriving node's load stage: its bundles are not pinned yet.
      if (live) {
        assets.state.restPending = true;
        assets.state.restedLive = true;
      }
      enforceBudget(assets);

      if (!live) return;

      startPreload(assets);
    },

    /**
     * Replaces the asset files a dev save changed, when the saved module is the stamp of the keys
     * watch. Only dev emits the event; the swap answers at once and works behind it.
     *
     * @param payload - The saved file and its new exports.
     */
    "ui:hot-swap": (payload: HotSwap): void => {
      // Inline, not `isDev()`, and a positive branch, not an early return: Bun folds this guard
      // under a production `define` and drops what is used only inside it, the swap module too.
      if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
        assets ??= withDeps(ctx);
        swap ??= createSwap(assets, reload);
        swap(payload);
      }
    }
  };
}
