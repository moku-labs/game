/**
 * @file renderer/monitor — API factory. The module keeps its data in `ctx.state.monitor` and reads
 * its counters through the injected `host` and `sync`; a capture places its legend through
 * `viewport` too. The clock of the counters is the `clock` plugin's (lint L3); the performance
 * monitor of an agent build reads the page clock through `monitor/clock.ts` alone. Every agent
 * branch is inline and positive, so a production `define` folds it and the performance code
 * leaves the bundle; the members of `monitor` then exist and do nothing.
 */
import type { Json } from "../../model/types";
import type { ThermalReading } from "../../time/types";
import type { MonitorModule, RendererCtx } from "../types";
import { cancelCaptures, captureFrame, serveCaptures } from "./capture";
import { pageNow } from "./clock";
import { openFrame } from "./commit";
import type { FrameRing, PerfChange, PerfEventName, PerfLogLine } from "./log-types";
import { countGlPasses } from "./passes";
import {
  attachPerf,
  beginAgent,
  endAgent,
  noteChange,
  notePath,
  notePauses,
  stopPerf,
  writeMark,
  writeThermal
} from "./perf";
import { EMPTY_RING } from "./ring";
import { flushPerf, subscribe, writeEvent } from "./stream";
import {
  type Captured,
  type CaptureOptions,
  COUNT,
  type MonitorCtx,
  type MonitorDeps,
  type MonitorState,
  type PerfCtx,
  type RenderStats
} from "./types";
import { BYTES_PER_MB, cell, roundTo } from "./units";
import { beginFrame, endFrame, resetWindow, STALE_MS } from "./window";

/**
 * The unsubscribe `stream` answers in a build without the agent flag: it does nothing.
 */
const noStream = (): void => {};

/**
 * The detail of an event written without one.
 */
const NO_DETAIL: Readonly<Record<string, Json>> = Object.freeze({});

/**
 * Message of a resolution `setResolution` refuses.
 *
 * @param value - What the caller passed.
 * @returns The message.
 */
function resolutionMessage(value: unknown): string {
  return (
    `[game] renderer.monitor.setResolution(${String(value)}) needs a number from 0.5 to 4.\n` +
    "  Pass undefined to go back to maxResolution."
  );
}

/**
 * Creates the monitor module: the counters of the renderer, the capture of a frame, and the
 * performance monitor of an agent build.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host`, `viewport`, `sync` and `demand` modules.
 * @returns The monitor API and its internal half.
 */
export function createMonitorApi(ctx: RendererCtx, deps: MonitorDeps): MonitorModule {
  const state = ctx.state.monitor;
  const clock = ctx.deps.clock;
  const { passes, sinks } = state;
  const mctx: MonitorCtx = { ctx, deps };
  // Inline and positive: a production `define` folds it to `undefined`, and every branch below
  // that reads it goes with it.
  const pc: PerfCtx | undefined =
    typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && state.perf !== undefined
      ? { ctx, deps, perf: state.perf, sinks: state.sinks }
      : undefined;

  /**
   * A measured pass number, or the slot estimate where no counter saw a drawn frame (F8): headless, a test stage.
   *
   * @param counted - The measured number; 0 before a counter saw one.
   * @returns The number `stats()` reports.
   */
  const measured = (counted: number): number =>
    sinks.measuring && counted > 0 ? counted : deps.sync.renderPasses();

  /**
   * Closes the pass count of a frame: a drawn frame whose passes a counter saw is the new `renderPasses`; a skipped
   * frame keeps both numbers. The frame closes here, except in an agent build, whose commit closes it after the
   * record is written.
   *
   * @param drawn - True when the render phase drew the frame.
   */
  const notePasses = (drawn: boolean): void => {
    const count = cell(sinks.counts, COUNT.passes);

    if (drawn && count > 0) {
      passes.last = count;
      passes.open = Math.max(passes.open, count);
    }

    if (pc === undefined) sinks.inFrame = false;
  };

  return {
    stats: (): RenderStats => {
      const usage = deps.host.textures();
      const counts = deps.sync.counts();
      const drawing = state.lastStart !== undefined && clock.now() - state.lastStart <= STALE_MS;
      const stats: RenderStats = {
        fps: drawing ? roundTo(state.fps, 1) : 0,
        drawn: drawing ? roundTo(state.drawnFps, 1) : 0,
        frameMs: roundTo(state.frameMs, 2),
        textures: usage.count,
        textureMb: roundTo(usage.bytes / BYTES_PER_MB, 2),
        textureMbSplit: {
          art: roundTo(usage.art / BYTES_PER_MB, 2),
          targets: roundTo(usage.targets / BYTES_PER_MB, 2),
          kept: roundTo(usage.kept / BYTES_PER_MB, 2)
        },
        views: counts.views,
        pooled: counts.pooled,
        renderPasses: measured(passes.last),
        renderPassesMax: measured(passes.max),
        kept: deps.kept.stats()
      };

      // The dev or agent guard, inline as in `capture()`: the field is absent from a production
      // build, not undefined.
      if (
        (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
        (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
      ) {
        return stats;
      }

      return { ...stats, drawCalls: state.draws.last };
    },

    capture: async (options: CaptureOptions = {}): Promise<Captured | undefined> => {
      // The dev or agent guard, inline, not `isDev()`: Bun folds it under a production `define` of
      // both flags `false` and drops the capture from the bundle (`flow/doors/dev.ts` declares
      // the globals).
      if (
        (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
        (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
      ) {
        return undefined;
      }

      return captureFrame(mctx, options);
    },

    stream: (listener: (line: PerfLogLine) => void): (() => void) => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        return subscribe(pc, listener);
      }

      return noStream;
    },

    frames: (): FrameRing => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        return pc.perf.ring;
      }

      return EMPTY_RING;
    },

    mark: (label: string): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        writeMark(pc, label, false);
      }
    },

    event: (name: PerfEventName, detail: Readonly<Record<string, Json>> = NO_DETAIL): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        writeEvent(pc, name, detail);
      }
    },

    beginAgent: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        beginAgent(pc.perf);
      }
    },

    endAgent: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        endAgent(pc);
      }
    },

    setResolution: (resolution: number | undefined): number => {
      // Every build (LEAD-FIXES-4 item 1): a player's graphics setting is applied through here.
      if (
        resolution !== undefined &&
        !(typeof resolution === "number" && resolution >= 0.5 && resolution <= 4)
      ) {
        throw new RangeError(resolutionMessage(resolution));
      }

      return deps.host.overrideResolution(resolution);
    },

    begin: (): void => {
      // A closed window reads the takes of its second: `stats().kept.retakes`.
      if (beginFrame(state, clock.now())) deps.kept.drainTakes();
      // A draw between two frames, as the extract of a capture, is not a draw of this frame.
      state.draws.frame = 0;
      // The passes of this frame, counted in every build (F8); a pass between frames is not.
      sinks.counts[COUNT.passes] = 0;
      sinks.inFrame = true;

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        openFrame(pc.sinks);
      }
    },

    end: (drawn: boolean): void => {
      endFrame(state, clock.now());
      // A skipped frame keeps the draw calls of the last drawn one.
      if (drawn) state.draws.last = state.draws.frame;
      state.draws.frame = 0;
      state.lastDrawn = drawn;
      notePasses(drawn);

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        pc.perf.drawn = drawn;
      }

      // A capture waits for a drawn frame; a waiting capture makes the frame drawn.
      if (drawn) serveCaptures(mctx);
    },

    waiting: (): boolean => state.captures.length > 0,

    changed: (change: PerfChange): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        noteChange(pc.perf, change);
      }
    },

    attach: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        attachPerf(pc);
      }
    },

    attachPasses: (): void => {
      // An agent build counts through `attach`; WebGPU through the encoder `host` installed.
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) return;

      for (const off of state.passDetach) off();
      state.passDetach.length = 0;

      const app = ctx.state.host.app;

      if (deps.host.kind() === "webgl" && app !== undefined) {
        state.passDetach.push(countGlPasses(app.renderer, sinks));
      }
    },

    flush: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        pc.perf.staged[1] = pageNow();
        flushPerf(pc);
      }
    },

    count: (_counter: "rebuilds", amount: number): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        pc.perf.produced |= 1;
        pc.sinks.counts[COUNT.rebuilds] = cell(pc.sinks.counts, COUNT.rebuilds) + amount;
      }
    },

    path: (path: string, rest: boolean): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        notePath(pc, path, rest);
      }
    },

    thermal: (reading: ThermalReading): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        writeThermal(pc, reading);
      }
    },

    pauses: (reasons: readonly string[], paused: boolean, resumed: boolean): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        notePauses(pc, reasons, paused, resumed);
      }
    }
  };
}

/**
 * Stops the monitor: a capture still waiting gets `undefined`, and every frame seen is forgotten.
 * Works on the state alone, because `onStop` has no context. The draw counter keeps its identity:
 * only its numbers go back to 0. An agent build also stops its performance monitor.
 *
 * @param state - The monitor branch of the plugin state.
 */
export function stopMonitor(state: MonitorState): void {
  cancelCaptures(state);
  resetWindow(state);
  state.draws.frame = 0;
  state.draws.last = 0;
  state.sinks.inFrame = false;

  for (const off of state.passDetach) off();
  state.passDetach.length = 0;

  if (
    typeof __MOKU_GAME_AGENT__ !== "undefined" &&
    __MOKU_GAME_AGENT__ &&
    state.perf !== undefined
  ) {
    stopPerf(state.perf, state.sinks);
  }
}
