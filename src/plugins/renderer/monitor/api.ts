/**
 * @file renderer/monitor — API factory. The module keeps its data in `ctx.state.monitor` and reads
 * its counters through the injected `host` and `sync`; a capture places its legend through
 * `viewport` too. The clock is the `clock` plugin's, since the renderer never reads the device
 * clock itself (lint L3).
 */
import type { MonitorModule, RendererCtx } from "../types";
import { cancelCaptures, captureFrame, serveCaptures } from "./capture";
import type {
  Captured,
  CaptureOptions,
  MonitorCtx,
  MonitorDeps,
  MonitorState,
  RenderStats
} from "./types";
import { beginFrame, endFrame, resetWindow, STALE_MS } from "./window";

/** Bytes of one MiB. */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Rounds a number to a fixed count of decimals, so a counter reads well in a panel.
 *
 * @param value - The number.
 * @param decimals - Decimals to keep.
 * @returns The rounded number.
 * @example
 * ```ts
 * roundTo(3.456_78, 2); // 3.46
 * ```
 */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

/**
 * Creates the monitor module: the counters of the renderer and the capture of a frame.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host`, `viewport` and `sync` modules.
 * @returns The monitor API and its internal half.
 */
export function createMonitorApi(ctx: RendererCtx, deps: MonitorDeps): MonitorModule {
  const state = ctx.state.monitor;
  const clock = ctx.deps.clock;
  const mctx: MonitorCtx = { ctx, deps };

  return {
    stats: (): RenderStats => {
      const usage = deps.host.textures();
      const counts = deps.sync.counts();
      const drawing = state.lastStart !== undefined && clock.now() - state.lastStart <= STALE_MS;
      const stats: RenderStats = {
        fps: drawing ? roundTo(state.fps, 1) : 0,
        frameMs: roundTo(state.frameMs, 2),
        textures: usage.count,
        textureMb: roundTo(usage.bytes / BYTES_PER_MB, 2),
        views: counts.views,
        pooled: counts.pooled,
        renderPasses: deps.sync.renderPasses()
      };

      // Inline, as in `capture()`: the field is absent from a production build, not undefined.
      if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return stats;

      return { ...stats, drawCalls: state.draws.last };
    },

    capture: async (options: CaptureOptions = {}): Promise<Captured | undefined> => {
      // Inline, not `isDev()`: Bun folds this guard under `define: { __MOKU_GAME_DEV__: "false" }`
      // and drops the capture from a production bundle (`flow/doors/dev.ts` declares the global).
      if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return undefined;

      return captureFrame(mctx, options);
    },

    begin: (): void => {
      beginFrame(state, clock.now());
      // A draw between two frames, as the extract of a capture, is not a draw of this frame.
      state.draws.frame = 0;
    },

    end: (): void => {
      endFrame(state, clock.now());
      state.draws.last = state.draws.frame;
      state.draws.frame = 0;
      serveCaptures(mctx);
    }
  };
}

/**
 * Stops the monitor: a capture still waiting gets `undefined`, and every frame seen is forgotten.
 * Works on the state alone, because `onStop` has no context. The draw counter keeps its identity:
 * only its numbers go back to 0.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function stopMonitor(state: MonitorState): void {
  cancelCaptures(state);
  resetWindow(state);
  state.draws.frame = 0;
  state.draws.last = 0;
}
