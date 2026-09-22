/**
 * @file The one narrowing of `ctx.emit` in the assets plugin. Core 1.7 drops a plugin's own events
 * from the factory context once `depends` is declared (see the note on `KernelSlice`), so the two
 * event sites share this single cast instead of each carrying one.
 */
import type { AssetsCtx, EmitAssets } from "./types";

/**
 * Narrows the kernel's `emit` to the two events of the plugin.
 *
 * @param ctx - The plugin context.
 * @returns `ctx.emit`, typed for `assets:bundle-loaded` and `assets:bundle-unloaded`.
 */
export function emitOf(ctx: AssetsCtx): EmitAssets {
  return ctx.emit as EmitAssets;
}
