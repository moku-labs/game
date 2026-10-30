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
import type { CaptureSpan } from "./capture";
import { cancelCaptures, captureFrame, serveCaptures } from "./capture";
import { pageNow } from "./clock";
import { openFrame } from "./commit";
import { readCounts, registerCount } from "./counts";
import type {
  FrameRing,
  MonitorSections,
  PerfChange,
  PerfEventName,
  PerfLogLine
} from "./log-types";
import { countGlPasses, noteRestart } from "./passes";
import {
  attachPerf,
  beginAgent,
  endAgent,
  noteChange,
  notePath,
  notePauses,
  refuseSections,
  stopPerf,
  switchSections,
  writeMark,
  writeThermal
} from "./perf";
import { EMPTY_RING } from "./ring";
import { ALL_SECTIONS } from "./sections";
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
import { BYTES_PER_MB, cellF64, roundTo } from "./units";
import { beginStaged, endStaged, resetWindow, STALE_MS } from "./window";

/**
 * The unsubscribe `stream` answers in a build without the agent flag: it does nothing.
 */
const noStream = (): void => {};

/**
 * The remover `counts.register` answers in a build without the agent flag: it does nothing.
 */
const noCount = (): void => {};

/**
 * The detail of an event written without one.
 */
const NO_DETAIL: Readonly<Record<string, Json>> = Object.freeze({});

/** The fewest device pixels per CSS pixel `setResolution` draws at. */
const MIN_RESOLUTION = 0.5;

/** The most device pixels per CSS pixel `setResolution` draws at. */
const MAX_RESOLUTION = 4;

/**
 * Message of a resolution `setResolution` refuses.
 *
 * @param value - What the caller passed.
 * @returns The message.
 */
function resolutionMessage(value: unknown): string {
  return (
    `[game] renderer.monitor.setResolution(${String(value)}) needs a number from ${MIN_RESOLUTION} to ${MAX_RESOLUTION}.\n` +
    "  Pass undefined to go back to maxResolution."
  );
}

/**
 * Tells whether `setResolution` takes a value: a number from `MIN_RESOLUTION` to `MAX_RESOLUTION`, or `undefined` to
 * go back.
 *
 * @param value - What the caller passed.
 * @returns True when it is taken.
 * @example
 * ```ts
 * takesResolution(1.75); // true
 * ```
 */
function takesResolution(value: number | undefined): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && value >= MIN_RESOLUTION && value <= MAX_RESOLUTION)
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
  const { canvas, passes, sinks } = state;
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
   * A measured canvas pass number, or the estimate of the filter slots where nothing counted one: headless, a test
   * stage, a canvas with multisampling, which Pixi begins itself.
   *
   * @param counted - The measured number; 0 before a counter saw one.
   * @returns The number `stats()` reports.
   */
  const measuredCanvas = (counted: number): number =>
    counted > 0 ? counted : deps.sync.canvasPasses();

  /**
   * Hears a canvas pass that really began on WebGPU, in every build: one increment inside a frame, and in an agent
   * build its reason in the pass ring. Made once: `host/render-pass.ts` calls it through the host's state.
   *
   * @param restart - The reason, an index into `CANVAS_RESTARTS`.
   */
  const canvasBegan = (restart: number): void => {
    if (!sinks.inFrame) return;

    sinks.counts[COUNT.canvas] = cellF64(sinks.counts, COUNT.canvas) + 1;

    if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
      noteRestart(pc, restart);
    }
  };

  /**
   * Closes the pass counts of a frame: a drawn frame whose passes a counter saw is the new `renderPasses` and
   * `canvasPasses`; a skipped frame keeps the numbers. The frame closes here, except in an agent build, whose commit
   * closes it after the record is written.
   *
   * @param drawn - True when the render phase drew the frame.
   */
  const notePasses = (drawn: boolean): void => {
    const count = cellF64(sinks.counts, COUNT.passes);
    const canvasCount = cellF64(sinks.counts, COUNT.canvas);

    if (drawn && count > 0) {
      passes.last = count;
      passes.open = Math.max(passes.open, count);
    }

    if (drawn && canvasCount > 0) {
      canvas.last = canvasCount;
      canvas.open = Math.max(canvas.open, canvasCount);
    }

    if (pc === undefined) sinks.inFrame = false;
  };

  /**
   * The agent span: `beginAgent` and `endAgent`, also the span the captures are taken in.
   */
  const agentSpan: CaptureSpan = {
    begin: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        beginAgent(pc.perf);
      }
    },
    end: (): void => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        endAgent(pc);
      }
    }
  };

  return {
    stats: (): RenderStats => {
      const usage = deps.host.textures();
      const counts = deps.sync.counts();
      const drawing = !Number.isNaN(state.lastStart) && clock.now() - state.lastStart <= STALE_MS;
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
        canvasPasses: measuredCanvas(canvas.last),
        canvasPassesMax: measuredCanvas(canvas.max),
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

      const dev = {
        ...stats,
        drawCalls: state.draws.last,
        redraws: roundTo(state.redraws, 1),
        rebuilds: roundTo(state.rebuilds, 1)
      };

      // The live object counts the log samples, the same values: agent builds only.
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        return { ...dev, counts: readCounts(pc) };
      }

      return dev;
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

    beginAgent: agentSpan.begin,

    endAgent: agentSpan.end,

    sections: (next?: Partial<MonitorSections>): Readonly<MonitorSections> => {
      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        if (next === undefined) return pc.perf.sections;
        // A switch changes what the page measures: a dev page or one with control (`--debug`) only.
        if (
          (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_CONTROL__ !== "undefined" && __MOKU_GAME_CONTROL__)
        ) {
          return switchSections(pc, next);
        }

        return refuseSections(pc, next);
      }

      return ALL_SECTIONS;
    },

    counts: {
      register: (name: string, read: () => number): (() => void) => {
        if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
          return registerCount(pc.perf.counts, name, read);
        }

        return noCount;
      }
    },

    setResolution: (resolution: number | undefined): number => {
      // Every build (LEAD-FIXES-4 item 1): a player's graphics setting is applied through here.
      if (!takesResolution(resolution)) throw new RangeError(resolutionMessage(resolution));

      return deps.host.overrideResolution(resolution);
    },

    begin: (): void => {
      // per frame: the clock reading staged, not passed (a double handed to a call is boxed). A closed window reads the
      // takes of its second: `stats().kept.retakes`.
      state.staged[0] = clock.now();
      if (beginStaged(state)) deps.kept.drainTakes();
      // A draw between two frames, as the extract of a capture, is not a draw of this frame.
      state.draws.frame = 0;
      // The passes of this frame, counted in every build (F8); a pass between frames is not.
      sinks.counts[COUNT.passes] = 0;
      sinks.counts[COUNT.canvas] = 0;
      sinks.inFrame = true;

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        openFrame(pc.sinks);
      }
    },

    end: (drawn: boolean): void => {
      // The engine's redraws are counted in every build (an increment is cheaper than a guard) and taken every frame.
      state.staged[0] = clock.now();
      endStaged(state, deps.sync.takeRedraws(), sinks.rebuildsWindow);
      sinks.rebuildsWindow = 0;
      // A skipped frame keeps the draw calls of the last drawn one.
      if (drawn) state.draws.last = state.draws.frame;
      state.draws.frame = 0;
      state.lastDrawn = drawn;
      notePasses(drawn);

      if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && pc !== undefined) {
        pc.perf.drawn = drawn;
      }

      // A capture waits for a drawn frame; a waiting capture makes the frame drawn.
      if (drawn) serveCaptures(mctx, agentSpan);
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
        // The counting batcher pipe feeds the rebuilds column from now on (spec 26 R2.3, spec 11 R8.8).
        if (ctx.state.host.uninstallCounting !== undefined) pc.perf.produced |= 1;
      }
    },

    attachPasses: (): void => {
      // Every build hears the canvas passes through the host: the file that begins them never imports the monitor.
      deps.host.onCanvasPass(canvasBegan);

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
        pc.sinks.counts[COUNT.rebuilds] = cellF64(pc.sinks.counts, COUNT.rebuilds) + amount;
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
  state.sinks.rebuildsWindow = 0;

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
