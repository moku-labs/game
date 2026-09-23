/**
 * @file renderer/monitor — state factory.
 */
import type { MonitorState } from "./types";

/**
 * Creates the initial monitor state: no frame seen, an empty window, no capture waiting.
 *
 * @returns The monitor branch of the plugin state.
 */
export function createMonitorState(): MonitorState {
  return {
    frameStart: undefined,
    lastStart: undefined,
    windowMs: 0,
    intervals: 0,
    workMs: 0,
    frames: 0,
    fps: 0,
    frameMs: 0,
    captures: []
  };
}
