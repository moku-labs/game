/**
 * @file renderer/viewport — the resize observer and the teardown of the module. One resize is
 * applied per frame, in the `render` callback, never in the observer itself.
 */
import type { ViewportCtx, ViewportState } from "./types";

/**
 * Measures the mount in CSS pixels.
 *
 * @param vctx - Domain context of the viewport module.
 * @returns The size of the mount, or zero while inert.
 */
export function measureMount(vctx: ViewportCtx): { width: number; height: number } {
  const mount = vctx.deps.host.mount();

  if (mount === undefined) return { width: 0, height: 0 };

  return { width: mount.clientWidth, height: mount.clientHeight };
}

/**
 * Observes the mount. The observer only raises a flag: the frame decides when to apply it, so a
 * burst of resize events costs one layout.
 *
 * @param vctx - Domain context of the viewport module.
 */
export function watchResize(vctx: ViewportCtx): void {
  const mount = vctx.deps.host.mount();

  if (mount === undefined || typeof globalThis.ResizeObserver !== "function") return;

  const state = vctx.ctx.state.viewport;
  const observer = new globalThis.ResizeObserver(() => {
    state.resizePending = true;
  });

  observer.observe(mount);
  state.cleanups.push(() => observer.disconnect());
}

/**
 * Drops the observer and the probe. Works on the state alone, because `onStop` has no context.
 *
 * @param state - The viewport branch of the plugin state.
 */
export function stopViewport(state: ViewportState): void {
  for (const off of state.cleanups) off();
  state.cleanups.length = 0;
  state.probe?.remove();
  state.probe = undefined;
  state.resizePending = false;
  state.frame = { x: 0, y: 0, width: 0, height: 0 };
  state.reference = { width: 0, height: 0 };
  state.safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  state.scale = 1;
}
