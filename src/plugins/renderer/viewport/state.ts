/**
 * @file renderer/viewport — state factory.
 */
import type { ViewportState } from "./types";

/**
 * Creates the initial viewport state: an empty frame at scale 1 and no safe area. The first
 * measurement happens when the host is ready; before that `size()` answers from the config.
 *
 * @returns The viewport branch of the plugin state.
 */
export function createViewportState(): ViewportState {
  return {
    frame: { x: 0, y: 0, width: 0, height: 0 },
    scale: 1,
    reference: { width: 0, height: 0 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    resizePending: false,
    probe: undefined,
    cleanups: []
  };
}
