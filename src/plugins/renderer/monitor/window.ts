/**
 * @file renderer/monitor — the measuring window: frames per second and the mean frame work over
 * one second of clock time. Plain arithmetic on the state, no allocation per frame.
 */
import type { MonitorState } from "./types";

/** Length of one measuring window, in clock milliseconds. */
export const WINDOW_MS = 1000;

/** A gap between two frame starts longer than this is a pause, not a slow frame. */
export const STALE_MS = 1000;

/**
 * Empties the open window.
 *
 * @param state - The monitor branch of the plugin state.
 */
function openWindow(state: MonitorState): void {
  state.windowMs = 0;
  state.intervals = 0;
  state.workMs = 0;
  state.frames = 0;
}

/**
 * Turns the open window into the reported numbers and opens the next one.
 *
 * @param state - The monitor branch of the plugin state.
 */
function closeWindow(state: MonitorState): void {
  state.fps = (state.intervals * WINDOW_MS) / state.windowMs;
  state.frameMs = state.frames > 0 ? state.workMs / state.frames : 0;
  openWindow(state);
}

/**
 * Marks the start of a frame. The interval since the last start joins the window, and a window
 * that reached one second closes. A gap longer than `STALE_MS` restarts the window, so a pause or
 * a hidden tab does not read as one very slow frame.
 *
 * @param state - The monitor branch of the plugin state.
 * @param now - Clock time of the frame start, in milliseconds.
 * @example
 * ```ts
 * beginFrame(state, 1000); // after 50 starts 20 ms apart from 0: state.fps is 50
 * ```
 */
export function beginFrame(state: MonitorState, now: number): void {
  const previous = state.lastStart;

  state.lastStart = now;
  state.frameStart = now;

  if (previous === undefined || now - previous > STALE_MS) {
    openWindow(state);

    return;
  }

  state.windowMs += now - previous;
  state.intervals += 1;

  if (state.windowMs >= WINDOW_MS) closeWindow(state);
}

/**
 * Marks the end of a frame and adds its work to the window. An end without a seen start, as the
 * first frame after the renderer came up mid-frame, is ignored.
 *
 * @param state - The monitor branch of the plugin state.
 * @param now - Clock time at the end of `render`, in milliseconds.
 * @example
 * ```ts
 * endFrame(state, 1004); // the frame started at 1000: 4 ms of work join the window
 * ```
 */
export function endFrame(state: MonitorState, now: number): void {
  if (state.frameStart === undefined) return;

  state.workMs += now - state.frameStart;
  state.frames += 1;
  state.frameStart = undefined;
}

/**
 * Forgets every frame seen, as a stopped renderer does.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function resetWindow(state: MonitorState): void {
  openWindow(state);
  state.frameStart = undefined;
  state.lastStart = undefined;
  state.fps = 0;
  state.frameMs = 0;
}
