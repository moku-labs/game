/**
 * @file renderer/viewport — the resize observers and the teardown of the module. One resize is
 * applied per frame, in the `render` callback, never in an observer itself.
 */
import type { ViewportCtx, ViewportState } from "./types";

/**
 * Measures the mount in CSS pixels, fractions kept: at a fractional `devicePixelRatio` the window is 844.8 CSS px
 * tall, and `clientHeight` would round it to whole pixels and leave the last device rows of the page uncovered (F116).
 *
 * @param vctx - Domain context of the viewport module.
 * @returns The size of the mount, or zero while inert.
 */
export function measureMount(vctx: ViewportCtx): { width: number; height: number } {
  const mount = vctx.deps.host.mount();

  if (mount === undefined) return { width: 0, height: 0 };

  const box = mount.getBoundingClientRect();

  return { width: box.width, height: box.height };
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

/** The window event the native shell sends when it sets the `--moku-safe-*` properties or its insets change. */
const NATIVE_INSETS = "moku-native:insets";

/**
 * Watches the safe area: one observer on both probes, whose size is the insets, and the window
 * event of the native shell. Both only raise the flag the mount's observer raises, so an inset
 * that arrives late, a rotation that swaps left and right, or a shell that sets its own insets is
 * laid out at the next frame. The event's `detail` is not read: the probes are the one source.
 *
 * @param vctx - Domain context of the viewport module.
 */
export function watchSafeArea(vctx: ViewportCtx): void {
  const state = vctx.ctx.state.viewport;
  const { probes } = state;

  if (probes === undefined) return;

  const raise = (): void => {
    state.resizePending = true;
  };

  if (typeof globalThis.ResizeObserver === "function") {
    const observer = new globalThis.ResizeObserver(raise);

    observer.observe(probes.start);
    observer.observe(probes.end);
    state.cleanups.push(() => observer.disconnect());
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener(NATIVE_INSETS, raise);
    state.cleanups.push(() => globalThis.removeEventListener(NATIVE_INSETS, raise));
  }
}

/**
 * Drops the observers, the listener, the probes and the two `size()` objects. Works on the state
 * alone, because `onStop` has no context.
 *
 * @param state - The viewport branch of the plugin state.
 */
export function stopViewport(state: ViewportState): void {
  for (const off of state.cleanups) off();
  state.cleanups.length = 0;
  state.probes?.start.remove();
  state.probes?.end.remove();
  state.probes = undefined;
  state.resizePending = false;
  state.frame = { x: 0, y: 0, width: 0, height: 0 };
  state.reference = { width: 0, height: 0 };
  state.safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  state.scale = 1;
  state.size = undefined;
  state.inert = undefined;
}
