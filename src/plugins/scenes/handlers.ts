/**
 * @file scenes plugin — the hook of `assets` (F107 part 1): every settled file of a bundle of the running switch moves
 * the progress its leave loader projection reads (`progress.ts`). It reads the plugin state only, so it allocates
 * nothing for an event that does not move the progress by a step. A bundle that is loaded is counted by the switch
 * itself, at its start and once the scene stage has its loads, not on `assets:bundle-loaded`: the kernel awaits each
 * handler of an event in plugin order, so a scenes handler there would move the font install of `text`, a later
 * plugin, one microtask later.
 */
import { countProgress } from "./progress";
import type { BundleProgress, KernelSlice } from "./types";

/**
 * Creates the hook handler. It reads the state only, which exists when the kernel registers hooks: the `feed` of a
 * switch is bound to `world` when the switch starts.
 *
 * @param ctx - Kernel context of the scenes plugin.
 * @returns The one hook of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "assets:bundle-progress": (payload: BundleProgress) => void;
} {
  return {
    "assets:bundle-progress": ({ bundle, loaded, total }: BundleProgress): void => {
      countProgress(ctx.state, bundle, loaded, total);
    }
  };
}
