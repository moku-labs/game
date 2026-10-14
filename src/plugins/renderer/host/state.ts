/**
 * @file renderer/host — state factory.
 */
import type { HostState } from "./types";

/**
 * Creates an empty weak set. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty weak set.
 */
function emptyWeakSet(): WeakSet<object> {
  return new WeakSet();
}

/**
 * Creates the initial host state: no Pixi, no application, nothing drawn, nothing listening, no
 * counting and no bitmap text pipe installed, the resolution of a page without a window (device
 * pixels 1, cap 2, no override, nothing pending), no own GPU and no kept picture.
 *
 * @returns The host branch of the plugin state.
 */
export function createHostState(): HostState {
  return {
    pixi: undefined,
    app: undefined,
    canvas: undefined,
    mount: undefined,
    kind: "none",
    ready: false,
    restoring: false,
    onReady: [],
    onRestore: [],
    onLoss: [],
    cleanups: [],
    unsupported: undefined,
    uninstallCounting: undefined,
    uninstallSdfText: undefined,
    resolution: { dpr: 1, cap: 2, override: undefined, pending: undefined },
    onResolutionChange: [],
    ownGpu: undefined,
    kept: emptyWeakSet(),
    pixelsFailed: false
  };
}
