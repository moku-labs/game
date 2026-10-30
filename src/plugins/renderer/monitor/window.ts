/**
 * @file renderer/monitor — the measuring window: frames per second, drawn frames per second, the
 * mean frame work, and the engine's redraws and Pixi's rebuilds per second, over one second of clock
 * time. Plain arithmetic on the state, no allocation per frame: the two clock fields hold NaN, never
 * `undefined`, so they stay doubles and a store never boxes one.
 */
import type { MonitorState } from "./types";
import { cellF64 } from "./units";

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
  state.drawnIntervals = 0;
  state.workMs = 0;
  state.frames = 0;
  state.redrawsOpen = 0;
  state.rebuildsOpen = 0;
}

/**
 * Turns the open window into the reported numbers and opens the next one: the most passes of a
 * frame in it become `renderPassesMax`, the most canvas passes `canvasPassesMax`.
 *
 * @param state - The monitor branch of the plugin state.
 */
function closeWindow(state: MonitorState): void {
  state.fps = (state.intervals * WINDOW_MS) / state.windowMs;
  state.drawnFps = (state.drawnIntervals * WINDOW_MS) / state.windowMs;
  state.frameMs = state.frames > 0 ? state.workMs / state.frames : 0;
  state.redraws = (state.redrawsOpen * WINDOW_MS) / state.windowMs;
  state.rebuilds = (state.rebuildsOpen * WINDOW_MS) / state.windowMs;
  state.passes.max = state.passes.open;
  state.passes.open = 0;
  state.canvas.max = state.canvas.open;
  state.canvas.open = 0;
  openWindow(state);
}

/**
 * Marks the start of a frame at a clock time: `beginStaged` with the time staged first.
 *
 * @param state - The monitor branch of the plugin state.
 * @param now - Clock time of the frame start, in milliseconds.
 * @returns True when a window closed: its counts were read.
 */
export function beginFrame(state: MonitorState, now: number): boolean {
  state.staged[0] = now;

  return beginStaged(state);
}

/**
 * Marks the start of a frame. The interval since the last start joins the window, and a window
 * that reached one second closes. The interval belongs to the last frame, whose decision is known:
 * it counts as a drawn one when that frame was drawn. A gap longer than `STALE_MS` restarts the
 * window, so a pause or a hidden tab does not read as one very slow frame.
 *
 * @param state - The monitor branch of the plugin state; `state.staged[0]` is the clock time of the frame start, in
 *   milliseconds, staged there, not passed: a double handed to a call is boxed, and this runs every frame.
 * @returns True when a window closed: its counts were read.
 */
export function beginStaged(state: MonitorState): boolean {
  const now = cellF64(state.staged, 0);
  const previous = state.lastStart;

  state.lastStart = now;
  state.frameStart = now;

  if (Number.isNaN(previous) || now - previous > STALE_MS) {
    openWindow(state);

    return false;
  }

  state.windowMs += now - previous;
  state.intervals += 1;
  if (state.lastDrawn) state.drawnIntervals += 1;

  if (state.windowMs < WINDOW_MS) return false;

  closeWindow(state);

  return true;
}

/**
 * Marks the end of a frame at a clock time: `endStaged` with the time staged first.
 *
 * @param state - The monitor branch of the plugin state.
 * @param now - Clock time at the end of `render`, in milliseconds.
 * @param redraws - `Graphics` paths the engine drew since the last end.
 * @param rebuilds - Pixi's instruction rebuilds since the last end.
 */
export function endFrame(state: MonitorState, now: number, redraws = 0, rebuilds = 0): void {
  state.staged[0] = now;
  endStaged(state, redraws, rebuilds);
}

/**
 * Marks the end of a frame and adds its work, its redraws and its rebuilds to the window. An end without a seen
 * start, as the first frame after the renderer came up mid-frame, is ignored.
 *
 * @param state - The monitor branch of the plugin state; `state.staged[0]` is the clock time at the end of `render`,
 *   in milliseconds, staged as for `beginStaged`.
 * @param redraws - `Graphics` paths the engine drew since the last end.
 * @param rebuilds - Pixi's instruction rebuilds since the last end.
 */
export function endStaged(state: MonitorState, redraws: number, rebuilds: number): void {
  if (Number.isNaN(state.frameStart)) return;

  state.redrawsOpen += redraws;
  state.rebuildsOpen += rebuilds;
  state.workMs += cellF64(state.staged, 0) - state.frameStart;
  state.frames += 1;
  state.frameStart = Number.NaN;
}

/**
 * Forgets every frame seen, as a stopped renderer does.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function resetWindow(state: MonitorState): void {
  openWindow(state);
  state.frameStart = Number.NaN;
  state.lastStart = Number.NaN;
  state.fps = 0;
  state.drawnFps = 0;
  state.lastDrawn = false;
  state.frameMs = 0;
  state.redraws = 0;
  state.rebuilds = 0;
  state.passes.last = 0;
  state.passes.open = 0;
  state.passes.max = 0;
  state.canvas.last = 0;
  state.canvas.open = 0;
  state.canvas.max = 0;
}
