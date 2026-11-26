/**
 * @file Stress plugin — its types: the kinds of a frame of the walk, the driver's state and what the page reads.
 */
import type { Session } from "../../state";

/** What a frame of the walk did; the code a row carries. */
export const KIND = {
  rest: 0,
  drag: 1,
  slide: 2,
  peek: 3,
  turn: 4,
  open: 5,
  close: 6,
  merge: 7,
  scroll: 8
} as const;

/** The state of the driver. */
export type StressState = {
  off: Array<() => void>;
  /** The kind of each frame, by `frame & 0xffff`. */
  kinds: Uint8Array;
  /** The JS heap at each frame, by `frame & 0xffff`: MB, 0 where the page has no `performance.memory`. */
  heap: Float32Array;
  /** The cursor into the frame ring. */
  cursor: number;
  /** Frames walked. */
  step: number;
  /** Kept entity lists of the board, read again after a merge. */
  pictures: readonly number[];
  rings: readonly number[];
  stale: boolean;
  /** Whether the walk runs. */
  running: boolean;
  /** The display object the fill estimate climbs to the stage from; `undefined` before the first estimate. */
  probe: unknown;
  /** Every line the monitor's stream wrote since the last read, as JSON text. */
  log: string[];
};

/** What the page reads: `game.stress`. */
export type StressApi = {
  /**
   * The frames the ring finished since the last call, oldest first, as rows of numbers (frame, kind, start, work,
   * six phases, GPU, draws, rebuilds, passes, filter Mpx, heap MB, five pairs of system index and ms, then the
   * monitor's cause bits, the demand reason, uploads, compiles and the agent's ms), with the names of the world
   * systems the rows index.
   *
   * @returns The rows, the names, and the frames the ring dropped before this read.
   * @example
   * ```ts
   * // The runner, every five seconds:
   * const { rows, systems } = game.stress.drain();
   * rows[0]?.[3]; // 4.2: the work of the oldest new frame, ms
   * ```
   */
  drain(): { rows: number[][]; systems: readonly string[]; lost: number };
  /**
   * The lines the monitor's stream wrote since the last call (the header, the per-second samples, the spikes, the
   * marks, the events), each as JSON text: the raw log of the run.
   *
   * @returns The lines, oldest first.
   * @example
   * ```ts
   * JSON.parse(game.stress.log()[0] ?? "{}").kind; // "header"
   * ```
   */
  log(): string[];
  /**
   * Starts or stops the walk; the scene rests while it is stopped.
   *
   * @param on - Whether the walk runs.
   * @example
   * ```ts
   * game.stress.run(false); // the scene stands still: the rows from now on are frames at rest
   * ```
   */
  run(on: boolean): void;
  /**
   * The scene of the page, how many entities carry a `Transform`, and the renderer's numbers now.
   *
   * @returns The session at the start, the count and `renderer.stats()`.
   * @example
   * ```ts
   * game.stress.info().entities; // 812
   * ```
   */
  info(): { session: Session; stats: unknown; entities: number };
  /**
   * An estimate of the pixels the frame on screen fills: every visible leaf of the Pixi stage by its bounding box,
   * cut to the canvas, at the canvas resolution. A box is more than the pixels a shape covers, a clip mask is not
   * applied, so it is an upper estimate of the overdraw.
   *
   * @returns The leaves counted, the megapixels they fill and the megapixels of the canvas.
   * @example
   * ```ts
   * game.stress.fill(); // { leaves: 412, mpx: 5.8, canvasMpx: 1.32 }: 4.4 layers of overdraw
   * ```
   */
  fill(): { leaves: number; mpx: number; canvasMpx: number };
};
