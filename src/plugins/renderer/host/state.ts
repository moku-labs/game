/**
 * @file renderer/host — state factory.
 */
import type { HostState, PoolState } from "./types";

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
 * Creates the state of the pool trim: no frame drawn, no scene change waiting, no rest judged, nothing trimmed.
 *
 * @returns The pool branch of the host state.
 */
export function createPoolState(): PoolState {
  return { lastDrawnAt: undefined, sceneAt: undefined, restDone: false, baseline: 0 };
}

/**
 * Creates the initial host state: no Pixi, no application, nothing drawn, nothing listening, no
 * counting, no bitmap text pipe and no render-group pipe installed, the resolution of a page without a window (device
 * pixels 1, cap 2, no override, nothing pending), no own GPU, no kept picture and no pool trim yet.
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
    uninstallPasses: undefined,
    uninstallSdfText: undefined,
    uninstallRenderGroup: undefined,
    resolution: { dpr: 1, cap: 2, override: undefined, pending: undefined },
    onResolutionChange: [],
    ownGpu: undefined,
    kept: emptyWeakSet(),
    pixelsFailed: false,
    pool: createPoolState(),
    onTrim: []
  };
}
