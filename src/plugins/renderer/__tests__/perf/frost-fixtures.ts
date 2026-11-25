/**
 * @file The boards of the Source perf windows (F126 stage 5). Not a test. A room under a `Source` with eight frosted
 * windows over it, all kept on their quads over the one shared result, on the whole renderer over real Pixi.
 */
import type { Entity } from "../../../world/types";
import { Parent, Shape, Source, Transform } from "../../components";
import type { PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { type BackSeam, backSeam, backSlot } from "../quad-harness";

/** The windows over the room: the ward's notes. */
const WINDOWS = 8;

/** A board at rest: the renderer, the room's child, a view outside the room and the windows. */
type FrostBoard = {
  readonly drawn: Drawn;
  readonly child: Entity;
  readonly other: Entity;
  readonly windows: readonly Entity[];
  /** The seam of each window's frosted slot. */
  readonly seams: readonly BackSeam[];
};

/**
 * Starts a room under a `Source` with a child, a view outside it, and eight frosted windows over it of one key, every
 * frame drawn, and lets it rest: the room taken once, every window kept on its quad.
 *
 * @returns The board.
 * @throws {Error} When a window is not on its quad over the Source.
 */
async function startFrostBoard(): Promise<FrostBoard> {
  const drawn = await startDrawn({ onDemand: false });
  const room = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 400, h: 400 }), Source());
  const child = drawn.spawn(
    Parent({ entity: room }),
    Transform({ x: 10, y: 10 }),
    Shape({ w: 20, h: 20 })
  );
  const windows: Entity[] = [];

  for (let index = 0; index < WINDOWS; index += 1) {
    windows.push(
      drawn.spawn(
        Transform({ x: 20 + (index % 4) * 90, y: 20 + Math.floor(index / 4) * 90 }),
        Shape({ w: 60, h: 60 })
      )
    );
  }

  const other = drawn.spawn(Transform({ x: 500, y: 500 }), Shape({ w: 10, h: 10 }));

  drawn.frame();

  const seams = windows.map(() => backSeam(7));

  for (const [index, window] of windows.entries()) {
    drawn.mock.api.sync.filters.set(window, Object.freeze([backSlot(seams[index])]));
  }

  drawn.frames(8);

  const { records } = drawn.mock.ctx.state.kept;

  if (
    records.length !== WINDOWS ||
    records.some(record => !record.shaded || record.held === undefined)
  ) {
    throw new Error("perf fixture: a window of the frost board is not on its quad over the Source");
  }

  return { drawn, child, other, windows, seams };
}

/**
 * The flush of a calm frame with no dirty Source: eight windows found as they were, the Source not taken.
 *
 * @returns One frame of the cache: the collect and the flush.
 */
export async function frostIdleBoard(): Promise<() => void> {
  const { drawn } = await startFrostBoard();
  const { kept } = drawn.mock.modules;

  return () => {
    kept.collect();
    kept.flush();
  };
}

/**
 * The flush of a frame with a mark outside the room: every window steps, its Source found from its cache, its result
 * current; the Source is not taken.
 *
 * @returns One frame of the cache: the mark, the collect and the flush.
 */
export async function frostSteppedBoard(): Promise<() => void> {
  const { drawn, other } = await startFrostBoard();
  const { kept, demand } = drawn.mock.modules;

  return () => {
    demand.mark(other);
    kept.collect();
    kept.flush();
  };
}

/**
 * The walk of a mark inside the room: its view and every ancestor, the Source among them made dirty. The collect alone:
 * the take is the flush's.
 *
 * @returns One mark: the mark and the collect.
 */
export async function frostDirtyBoard(): Promise<() => void> {
  const { drawn, child } = await startFrostBoard();
  const { kept, demand } = drawn.mock.modules;

  return () => {
    demand.mark(child);
    kept.collect();
  };
}

/**
 * The frame of eight windows that slide every frame over the room: each writes its placement in place, the Source is
 * not taken. The windows' tops are moved, as a layout write moves them, then marked.
 *
 * @returns One frame: the moves, the marks, the collect and the flush.
 */
export async function frostMovingBoard(): Promise<() => void> {
  const { drawn, windows } = await startFrostBoard();
  const { kept, demand } = drawn.mock.modules;
  const tops: PixiContainer[] = windows.map(window => {
    const view = drawn.mock.ctx.state.sync.views.get(window);

    if (view === undefined) throw new Error("perf fixture: a window has no view");

    return view.wrapper ?? view.object;
  });
  let step = 0;

  return () => {
    step = step === 0 ? 1 : 0;

    // eslint-disable-next-line unicorn/no-for-loop -- the measured frame: `entries()` would allocate its iterator.
    for (let index = 0; index < tops.length; index += 1) {
      const top = tops[index];
      const window = windows[index];

      if (top !== undefined && window !== undefined) {
        top.x += step === 0 ? -2 : 2;
        demand.markMoved(window);
      }
    }

    kept.collect();
    kept.flush();
  };
}

/**
 * The frame of a room that changes in every frame under eight windows of one key: the Source is taken, the one result
 * they share drawn again in place, and every window binds and places it again. The renders themselves are Pixi's (and
 * the stand-in's log of them): `host.renderTo` answers drawn without drawing, so the window counts the engine's bytes.
 *
 * @returns One frame: the mark inside the room, the collect and the flush.
 */
export async function frostLiveBoard(): Promise<() => void> {
  const { drawn, child } = await startFrostBoard();
  const { kept, demand, host } = drawn.mock.modules;

  host.renderTo = (): boolean => true;

  return () => {
    demand.mark(child);
    kept.collect();
    kept.flush();
  };
}

/**
 * The frame of eight windows whose blur is tweened together over a room at rest: every seam's steps move (its version,
 * and its key between two values), the Source is not taken, the one result they share is drawn again in place.
 *
 * @returns One frame: the steps moved, the collect and the flush.
 */
export async function frostTweenBoard(): Promise<() => void> {
  const { drawn, seams } = await startFrostBoard();
  const { kept, host } = drawn.mock.modules;
  let step = 0;

  host.renderTo = (): boolean => true;

  return () => {
    step = step === 0 ? 1 : 0;

    // eslint-disable-next-line unicorn/no-for-loop -- the measured frame: `entries()` would allocate its iterator.
    for (let index = 0; index < seams.length; index += 1) {
      const seam = seams[index];

      if (seam !== undefined) {
        seam.state.version += 1;
        seam.state.key = step === 0 ? 7 : 8;
      }
    }

    kept.collect();
    kept.flush();
  };
}
