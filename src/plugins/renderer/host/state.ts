/**
 * @file renderer/host — state factory.
 */
import type { HostState } from "./types";

/**
 * Creates the initial host state: no Pixi, no application, nothing drawn and nothing listening.
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
    unsupported: undefined
  };
}
