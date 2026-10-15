/**
 * @file renderer/host — the resolution the canvas draws at (contract C-d): the device pixels, the cap of
 * `maxResolution`, the override of `monitor.setResolution`, and the listener that follows a change of
 * `devicePixelRatio`. Every change is asked through one mechanism and applied on the resize path of the next frame,
 * so a burst of changes costs one resize.
 */
import type { RendererCtx } from "../types";
import type { HostState } from "./types";

/**
 * Why the resolution changed. Exported: `HostInternal` and spec 14's demand subscriber use it (11-I14).
 */
export type ResolutionReason = "dpr" | "setting" | "debug";

/**
 * Device pixels per CSS pixel of the window; 1 without a window. Moved here from `host/init.ts`.
 *
 * @returns The ratio the drawing resolution is capped against.
 */
export function devicePixels(): number {
  return typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
}

/**
 * The resolution to draw at: the override, else the device pixels under the cap.
 *
 * @param state - The resolution state of the host.
 * @param state.dpr - Device pixels per CSS pixel.
 * @param state.cap - The cap of `maxResolution`.
 * @param state.override - The switch of `monitor.setResolution`, when set.
 * @returns The target resolution.
 * @example
 * ```ts
 * targetResolution({ dpr: 2.81, cap: 2, override: undefined }); // 2
 * ```
 */
export function targetResolution(state: {
  dpr: number;
  cap: number;
  override: number | undefined;
}): number {
  return state.override ?? Math.min(state.dpr, state.cap);
}

/**
 * The one mechanism: remembers a resolution for the next frame. Nothing is applied here. While no
 * application is ready nothing is remembered: the next application reads the target itself.
 *
 * @param state - The host branch of the plugin state.
 * @param value - Device pixels per CSS pixel.
 * @param reason - Why it changes.
 * @returns True when a change is now pending.
 */
export function askResolution(state: HostState, value: number, reason: ResolutionReason): boolean {
  const app = state.app;

  if (!state.ready || app === undefined) return false;
  if (value === app.renderer.resolution && state.resolution.pending === undefined) return false;

  state.resolution.pending = { value, reason };

  return true;
}

/**
 * Asks for the target resolution for a reason.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param reason - Why it changed.
 * @returns True when a change is now pending.
 */
export function refreshResolution(ctx: RendererCtx, reason: ResolutionReason): boolean {
  const state = ctx.state.host;

  return askResolution(state, targetResolution(state.resolution), reason);
}

/**
 * Resizes the renderer to a CSS-pixel size, at the pending resolution when one differs from what
 * Pixi draws at; the listeners hear the change. The pending change is gone afterwards either way.
 *
 * @param state - The host branch of the plugin state.
 * @param width - New CSS width of the canvas.
 * @param height - New CSS height of the canvas.
 */
export function resizeAt(state: HostState, width: number, height: number): void {
  const app = state.app;

  if (!state.ready || app === undefined) return;

  const { pending } = state.resolution;
  const from = app.renderer.resolution;

  state.resolution.pending = undefined;

  if (pending === undefined || pending.value === from) {
    app.renderer.resize(width, height);

    return;
  }

  app.renderer.resize(width, height, pending.value);

  for (const fn of state.onResolutionChange) fn(from, pending.value, pending.reason);
}

/**
 * Follows `devicePixelRatio` with a `matchMedia` query of the ratio the page has now, armed once
 * and armed again for the new ratio after every change: a window moved to a screen of another
 * ratio, or a browser zoom, draws sharp from the next frame. Every build. The remover goes to
 * `state.cleanups`. No window or no `matchMedia`: nothing is armed.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function watchPixelRatio(ctx: RendererCtx): void {
  if (typeof globalThis.matchMedia !== "function") return;

  const state = ctx.state.host;
  let query: MediaQueryList | undefined;

  /**
   * Arms the query for the ratio the page has now.
   */
  function arm(): void {
    query = globalThis.matchMedia(`(resolution: ${state.resolution.dpr}dppx)`);
    query.addEventListener("change", follow, { once: true });
  }

  /**
   * Reads the new ratio, asks for the target and arms again.
   */
  function follow(): void {
    state.resolution.dpr = devicePixels();
    refreshResolution(ctx, "dpr");
    arm();
  }

  arm();
  state.cleanups.push(() => query?.removeEventListener("change", follow));
}
