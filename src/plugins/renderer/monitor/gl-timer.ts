/**
 * @file renderer/monitor — GPU time per frame on WebGL (R7), with `EXT_disjoint_timer_query_webgl2` where the browser
 * has it. One `TIME_ELAPSED` query per render call of a frame, from a pool of 24 made at attach, begun and ended on
 * Pixi's public `prerender` and `postrender` runners; the pending queries are polled in order at every commit. A
 * disjoint GPU drops every pending result. No time per pass: WebGL forbids nested timer queries.
 */
import { noteGpuTime } from "./gpu-timer";
import { sectionOn } from "./sections";
import { type FrameTimer, type PerfCtx, SECTION } from "./types";
import { cellF32, cellF64, cellI32, cellU32 } from "./units";

/** Queries of the pool. */
const POOL_SIZE = 24;

/** Nanoseconds per millisecond. */
const NS_PER_MS = 1_000_000;

/**
 * The timer query extension, structurally: TypeScript's DOM lib does not type it.
 */
type TimerExtension = { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number };

/**
 * A runner of Pixi's renderer: items are objects with a method of the runner's name.
 */
type Runner = { add(item: object): unknown; remove(item: object): unknown };

/**
 * What the GL timer needs of Pixi's WebGL renderer: its two public runners.
 */
export type TimedRenderer = {
  readonly runners: { readonly prerender: Runner; readonly postrender: Runner };
};

/**
 * Reads the timer query extension of a context.
 *
 * @param gl - The application's WebGL2 context.
 * @returns The extension, or `undefined` without one.
 */
function timerExtension(gl: WebGL2RenderingContext): TimerExtension | undefined {
  const extension: unknown = gl.getExtension("EXT_disjoint_timer_query_webgl2");

  if (typeof extension !== "object" || extension === null) return undefined;

  const elapsed: unknown = Reflect.get(extension, "TIME_ELAPSED_EXT");
  const disjoint: unknown = Reflect.get(extension, "GPU_DISJOINT_EXT");

  if (typeof elapsed !== "number" || typeof disjoint !== "number") return undefined;

  return { TIME_ELAPSED_EXT: elapsed, GPU_DISJOINT_EXT: disjoint };
}

/**
 * Creates the WebGL timer of one application, or none where the browser has no timer queries:
 * then `gpuMs` stays NaN and the log says `null`.
 *
 * @param gl - The application's WebGL2 context.
 * @param renderer - Pixi's WebGL renderer: its `prerender` and `postrender` runners.
 * @param pc - The perf context.
 * @returns The timer, or `undefined`.
 */
export function createGlTimer(
  gl: WebGL2RenderingContext,
  renderer: TimedRenderer,
  pc: PerfCtx
): FrameTimer | undefined {
  const extension = timerExtension(gl);

  if (extension === undefined) return undefined;

  const pool: WebGLQuery[] = [];

  for (let index = 0; index < POOL_SIZE; index += 1) pool.push(gl.createQuery());

  // The free queries as a stack, the pending ones as a queue in begin order, with their frames.
  const free = new Int32Array(POOL_SIZE);
  const queue = new Int32Array(POOL_SIZE);
  const queueFrames = new Float64Array(POOL_SIZE);
  const queueSlots = new Int32Array(POOL_SIZE);
  const state = { free: POOL_SIZE, head: 0, pending: 0, active: -1, tried: false };

  for (let index = 0; index < POOL_SIZE; index += 1) free[index] = index;

  const begin = {
    /** Begins the query of a render call inside a frame, while none is active, one is free and `gpu` is on. */
    prerender: (): void => {
      if (!pc.sinks.inFrame || state.active !== -1 || !sectionOn(pc.sinks, SECTION.gpu)) return;

      state.tried = true;

      if (state.free === 0) return;

      state.free -= 1;
      state.active = cellI32(free, state.free);

      const query = pool[state.active];

      if (query !== undefined) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    }
  };
  const end = {
    /** Ends the active query and queues it with the frame running now. */
    postrender: (): void => {
      if (state.active === -1) return;

      gl.endQuery(extension.TIME_ELAPSED_EXT);

      const at = (state.head + state.pending) % POOL_SIZE;

      queue[at] = state.active;
      queueFrames[at] = pc.perf.frame;
      queueSlots[at] = -1;
      state.pending += 1;
      state.active = -1;
    }
  };

  /**
   * Takes the query at the head of the queue back into the pool.
   */
  const dequeue = (): void => {
    free[state.free] = cellI32(queue, state.head);
    state.free += 1;
    state.head = (state.head + 1) % POOL_SIZE;
    state.pending -= 1;
  };

  /**
   * Polls the pending queries in order and adds each available result to its frame; a disjoint
   * GPU drops them all.
   */
  const poll = (): void => {
    const { columns } = pc.perf.ring;

    if (state.pending > 0 && gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      while (state.pending > 0) dequeue();

      return;
    }

    while (state.pending > 0) {
      const query = pool[cellI32(queue, state.head)];

      if (query === undefined || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;

      const ms = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / NS_PER_MS;
      const slot = cellI32(queueSlots, state.head);
      const frame = cellF64(queueFrames, state.head);

      dequeue();

      if (slot < 0 || cellU32(columns.frame, slot) !== frame) continue;

      const before = cellF32(columns.gpuMs, slot);

      columns.gpuMs[slot] = Number.isNaN(before) ? ms : before + ms;

      // The frame's last query landed: its time is final.
      if (state.pending === 0 || cellF64(queueFrames, state.head) !== frame) {
        columns.gpuPartial[slot] = 0;
      }

      noteGpuTime(pc, slot);
    }
  };

  renderer.runners.prerender.add(begin);
  renderer.runners.postrender.add(end);

  return {
    kind: "disjoint-timer",

    commit: (slot: number, frame: number): void => {
      for (let index = 0; index < state.pending; index += 1) {
        const at = (state.head + index) % POOL_SIZE;

        if (cellF64(queueFrames, at) === frame) queueSlots[at] = slot;
      }

      if (state.tried) pc.perf.ring.columns.gpuPartial[slot] = 1;

      state.tried = false;
      poll();
    },

    // Nothing waits for a flush: the queries are polled at every commit.
    close: (): void => {},

    stop: (): void => {
      renderer.runners.prerender.remove(begin);
      renderer.runners.postrender.remove(end);

      for (const query of pool) gl.deleteQuery(query);
    }
  };
}
