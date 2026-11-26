/**
 * @file Stress plugin — its state and what the page reads: the frames of the engine's ring as rows of numbers.
 */
import { Display, Layer, type Renderer, Transform, type World } from "../../../../src/index.ts";
import { startingSession } from "../../state";
import type { StressApi, StressState } from "./types";

/** The owner of the display object the fill estimate climbs from. */
const PROBE_OWNER = { kind: "plugin", name: "stress.probe" } as const;

/** Frames of the ring left alone at a read: their GPU time arrives a few frames late. */
const LAG = 24;

/**
 * The state of a driver that has walked nothing yet.
 *
 * @returns A fresh state.
 */
export function createStressState(): StressState {
  return {
    off: [],
    kinds: new Uint8Array(65_536),
    heap: new Float32Array(65_536),
    cursor: 0,
    step: 0,
    pictures: [],
    rings: [],
    stale: true,
    running: true,
    probe: undefined,
    log: []
  };
}

/**
 * One frame of the ring as a row.
 *
 * @param state - The driver's state.
 * @param columns - The ring's columns.
 * @param slot - The slot of the frame.
 * @returns The row, rounded to a thousandth; -1 where the ring has no number.
 */
function rowOf(state: StressState, columns: Renderer.FrameRing["columns"], slot: number): number[] {
  const frame = columns.frame[slot] ?? 0;
  const row = [
    frame,
    state.kinds[frame & 0xff_ff] ?? 0,
    columns.startMs[slot] ?? 0,
    columns.workMs[slot] ?? 0,
    columns.phaseMs[slot * 6] ?? 0,
    columns.phaseMs[slot * 6 + 1] ?? 0,
    columns.phaseMs[slot * 6 + 2] ?? 0,
    columns.phaseMs[slot * 6 + 3] ?? 0,
    columns.phaseMs[slot * 6 + 4] ?? 0,
    columns.phaseMs[slot * 6 + 5] ?? 0,
    columns.gpuMs[slot] ?? Number.NaN,
    columns.draws[slot] ?? 0,
    columns.rebuilds[slot] ?? 0,
    columns.passes[slot] ?? 0,
    columns.filterMpx[slot] ?? 0,
    state.heap[frame & 0xff_ff] ?? 0
  ];

  for (let top = 0; top < 5; top += 1) {
    row.push(columns.sysIdx[slot * 5 + top] ?? 0xff_ff, columns.sysMs[slot * 5 + top] ?? 0);
  }

  row.push(
    columns.causes[slot] ?? 0,
    columns.reason[slot] ?? 255,
    columns.uploads[slot] ?? 0,
    columns.compiles[slot] ?? 0,
    columns.agentMs[slot] ?? 0
  );

  return row.map(value => (Number.isNaN(value) ? -1 : Math.round(value * 1000) / 1000));
}

/** What the estimate reads of a Pixi display object. */
type Leaf = {
  parent?: Leaf | null;
  children?: Leaf[];
  visible: boolean;
  renderable: boolean;
  alpha: number;
  renderPipeId?: string;
  getBounds(): { minX: number; minY: number; maxX: number; maxY: number };
};

/**
 * Adds the canvas pixels a subtree's visible leaves fill, by their bounding boxes.
 *
 * @param node - The display object.
 * @param width - The width of the canvas in CSS px.
 * @param height - Its height.
 * @param sum - The running total.
 * @param sum.leaves - The leaves counted.
 * @param sum.px - The CSS px they fill.
 */
function addFill(
  node: Leaf,
  width: number,
  height: number,
  sum: { leaves: number; px: number }
): void {
  if (!node.visible || !node.renderable || node.alpha <= 0) return;

  if (node.renderPipeId !== undefined) {
    const box = node.getBounds();
    const wide = Math.min(width, box.maxX) - Math.max(0, box.minX);
    const tall = Math.min(height, box.maxY) - Math.max(0, box.minY);

    if (wide > 0 && tall > 0) {
      sum.leaves += 1;
      sum.px += wide * tall;
    }
  }

  for (const child of node.children ?? []) addFill(child, width, height, sum);
}

/**
 * The stage of the page, reached from a display object of the bench's own: the first call hangs it, a later one
 * climbs from it.
 *
 * @param state - The driver's state.
 * @param renderer - The renderer: its Pixi module.
 * @param world - The world.
 * @returns The stage; `undefined` before Pixi is there and on the call that hangs the probe.
 */
function stageOf(
  state: StressState,
  renderer: Pick<Renderer.Api, "host">,
  world: Pick<World.Api, "ecs">
): Leaf | undefined {
  const pixi = renderer.host.pixi();

  if (pixi === undefined) return undefined;

  if (state.probe === undefined) {
    state.probe = new pixi.Container();
    world.ecs.spawn(PROBE_OWNER, [Layer({ name: "ui" }), Display({ object: state.probe })]);

    return undefined;
  }

  let stage = state.probe as Leaf;

  while (stage.parent !== undefined && stage.parent !== null) stage = stage.parent;

  return stage === state.probe ? undefined : stage;
}

/**
 * What the page reads.
 *
 * @param state - The driver's state.
 * @param renderer - The renderer: its monitor and its stats.
 * @param world - The world.
 * @returns The api.
 */
export function createStressApi(
  state: StressState,
  renderer: Pick<Renderer.Api, "monitor" | "stats" | "host">,
  world: Pick<World.Api, "ecs">
): StressApi {
  return {
    drain: () => {
      const ring = renderer.monitor.frames();
      const { capacity } = ring;
      const until = ring.written - LAG;
      const from = Math.max(state.cursor, until - capacity + LAG);
      const rows: number[][] = [];

      for (let at = from; at < until; at += 1) {
        // The newest frame is number `written - 1`, in slot `newest`.
        const slot = (((ring.newest - (ring.written - 1 - at)) % capacity) + capacity) % capacity;

        rows.push(rowOf(state, ring.columns, slot));
      }

      const lost = Math.max(0, from - state.cursor);

      state.cursor = Math.max(state.cursor, until);

      return { rows, systems: ring.systemNames, lost };
    },
    log: () => {
      const lines = state.log;

      state.log = [];

      return lines;
    },
    run: on => {
      state.running = on;
    },
    info: () => {
      const entities = [...world.ecs.query(Transform)].length;

      return { session: startingSession, stats: renderer.stats(), entities };
    },
    fill: () => {
      const canvas = document.querySelector("canvas");
      const pixi = renderer.host.pixi();
      const sum = { leaves: 0, px: 0 };

      if (canvas === null || pixi === undefined) return { leaves: 0, mpx: 0, canvasMpx: 0 };

      const stage = stageOf(state, renderer, world);

      if (stage === undefined) return { leaves: 0, mpx: 0, canvasMpx: 0 };

      const scale = canvas.width / Math.max(1, canvas.clientWidth);

      addFill(stage, canvas.clientWidth, canvas.clientHeight, sum);

      return {
        leaves: sum.leaves,
        mpx: Math.round((sum.px * scale * scale) / 10_000) / 100,
        canvasMpx: Math.round((canvas.width * canvas.height) / 10_000) / 100
      };
    }
  };
}
