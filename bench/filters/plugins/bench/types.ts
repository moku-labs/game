/**
 * @file The bench plugin's types: its API and the state of the run.
 */
import type { World } from "../../../../src/index.ts";
import type { BenchScene, Mounted } from "../../features/bench/scenes/types";
import type { ArmSummary, FrameSample } from "../../lib/readout";
import type { BenchHost } from "./api";

/** What a show may set. */
export type ShowOptions = {
  /** The full-screen sprites of the ballast; left out keeps those on screen. */
  k?: number;
  /** The count of a scene that takes one. */
  n?: number;
};

/** The numbers of the renderer at the end of an arm: they exist in a release build too. */
export type ArmStats = {
  canvasPasses: number;
  canvasPassesMax: number;
  frameMs: number;
  fps: number;
  evicted: number;
  refused: number;
};

/** One arm's numbers. */
export type ArmRow = {
  /** The scene. */
  scene: string;
  /** Its turn in the run, from 0. */
  slot: number;
  /** The sprites of the ballast under it. */
  k: number;
  /** `performance.timeOrigin`: origin + a frame's `t` is the phone's time. */
  origin: number;
  /** Each drawn frame of the ring, on a debug page; none on a release page. */
  frames: FrameSample[];
  /** How many canvas passes began for each reason, on a debug page. */
  restarts: Record<string, number>;
  /** The medians, on a debug page. */
  summary: ArmSummary;
  /** The renderer's numbers, on every page. */
  stats: ArmStats;
};

/** The scene that runs. */
export type Current = { scene: string; k: number; n: number | undefined };

/** The bench's API: `game.bench` on the page. */
export type BenchApi = {
  /**
   * The scenes of the table.
   *
   * @returns Their names.
   * @example
   * ```ts
   * game.bench.names().includes("slope-4-mask"); // true
   * ```
   */
  names(): readonly string[];
  /**
   * What each scene stands for.
   *
   * @param scene - The name.
   * @returns The line; `undefined` for a scene the table does not have.
   * @example
   * ```ts
   * game.bench.stands("ballast"); // "no filter: K full-screen batched sprites, the fill that holds the GPU clock"
   * ```
   */
  stands(scene: string): string | undefined;
  /**
   * The scene on screen.
   *
   * @returns The scene, or `undefined` before the first one.
   * @example
   * ```ts
   * game.bench.show("full", { k: 4 });
   * game.bench.current(); // { scene: "full", k: 4, n: undefined }
   * ```
   */
  current(): Current | undefined;
  /**
   * Puts a scene on screen in place of the one there, and ends a run of arms.
   *
   * @param scene - The name.
   * @param options - K and n.
   * @throws {Error} When the table has no such scene.
   * @example
   * ```ts
   * game.bench.show("slope-4", { k: 8 });
   * game.renderer.stats().canvasPasses; // 5, one frame later
   * ```
   */
  show(scene: string, options?: ShowOptions): void;
  /**
   * Turns through arms, each for `every` seconds, closing a row for each.
   *
   * @param arms - The scenes.
   * @param every - The seconds of an arm.
   * @param k - The ballast under all of them.
   * @throws {Error} When the table has no such scene.
   * @example
   * ```ts
   * game.bench.play(["slope-0", "slope-2"], 2, 8);
   * game.bench.rows().length; // 3, after six seconds
   * ```
   */
  play(arms: readonly string[], every: number, k?: number): void;
  /**
   * The numbers of the arm that runs, so far.
   *
   * @returns Its row.
   * @example
   * ```ts
   * game.bench.show("slope-2");
   * game.bench.read().summary.canvasPasses; // 3, on a debug page once it drew more than 6 frames
   * ```
   */
  read(): ArmRow;
  /**
   * The rows of the arms that ended.
   *
   * @returns One row per slot, oldest first.
   * @example
   * ```ts
   * game.bench.rows()[0]?.scene; // "slope-0", after the first slot of `play`
   * ```
   */
  rows(): readonly ArmRow[];
  /**
   * The sprites of the ballast.
   *
   * @returns Their entities.
   * @example
   * ```ts
   * game.bench.show("full", { k: 2 });
   * game.bench.ballast().length; // 2
   * ```
   */
  ballast(): readonly World.Entity[];
};

/** The arms that turn. */
export type Cycle = { arms: readonly string[]; everyMs: number; at: number; nextMs: number };

/** The state of the plugin. */
export type BenchState = {
  /** The engine as the bench reads it; set when the API is made. */
  host: BenchHost | undefined;
  scene: BenchScene | undefined;
  mounted: Mounted | undefined;
  /** The game time the scene mounted at. */
  mountedMs: number;
  /** The game time of the last frame. */
  nowMs: number;
  /** The sprites of the ballast. */
  ballast: World.Entity[];
  k: number;
  n: number | undefined;
  /** The ring's `written` when the arm began. */
  since: number;
  slot: number;
  rows: ArmRow[];
  cycle: Cycle | undefined;
  /** Removes the frame listener and the address listener. */
  off: (() => void)[];
};
