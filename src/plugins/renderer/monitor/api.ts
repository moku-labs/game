/**
 * @file renderer/monitor — API factory. The module keeps its data in `ctx.state.monitor` and reads
 * its counters through the injected `host` and `sync`; the clock is the `clock` plugin's, since
 * the renderer never reads the device clock itself (lint L3).
 */
import type { MonitorModule, RendererCtx } from "../types";
import type { MonitorDeps, MonitorState, RenderStats } from "./types";
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
 * Hands one picture to every capture that waited for it.
 *
 * @param waiting - The resolvers of the waiting captures.
 * @param url - The picture, or `undefined`.
 */
function settle(waiting: ReadonlyArray<(url: string | undefined) => void>, url?: string): void {
  for (const resolve of waiting) resolve(url);
}

/**
 * Creates the monitor module: the counters of the renderer and the capture of a frame.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host` and `sync` modules.
 * @returns The monitor API and its internal half.
 */
export function createMonitorApi(ctx: RendererCtx, deps: MonitorDeps): MonitorModule {
  const state = ctx.state.monitor;
  const clock = ctx.deps.clock;

  /**
   * Takes the picture the waiting captures asked for, once for all of them.
   */
  const flushCaptures = (): void => {
    if (state.captures.length === 0) return;

    const waiting = state.captures.splice(0);

    deps.host.extract().then(url => settle(waiting, url));
  };

  return {
    stats: (): RenderStats => {
      const usage = deps.host.textures();
      const counts = deps.sync.counts();
      const drawing = state.lastStart !== undefined && clock.now() - state.lastStart <= STALE_MS;

      return {
        fps: drawing ? roundTo(state.fps, 1) : 0,
        frameMs: roundTo(state.frameMs, 2),
        textures: usage.count,
        textureMb: roundTo(usage.bytes / BYTES_PER_MB, 2),
        views: counts.views,
        pooled: counts.pooled
      };
    },

    capture: async (): Promise<string | undefined> => {
      // Inline, not `isDev()`: Bun folds this guard under `define: { __MOKU_GAME_DEV__: "false" }`
      // and drops the capture from a production bundle (`flow/doors/dev.ts` declares the global).
      if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return undefined;

      if (!deps.host.ready()) return undefined;

      ctx.log.debug("moku:dev", { command: "renderer.capture" });

      if (ctx.deps.time.isPaused()) return deps.host.extract();

      return new Promise(resolve => {
        state.captures.push(resolve);
      });
    },

    begin: (): void => {
      beginFrame(state, clock.now());
    },

    end: (): void => {
      endFrame(state, clock.now());
      flushCaptures();
    }
  };
}

/**
 * Stops the monitor: a capture still waiting gets `undefined`, and every frame seen is forgotten.
 * Works on the state alone, because `onStop` has no context.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function stopMonitor(state: MonitorState): void {
  settle(state.captures.splice(0));
  resetWindow(state);
}
