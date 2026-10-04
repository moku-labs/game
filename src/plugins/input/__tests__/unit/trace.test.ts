import { describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { createInputApi } from "../../api";
import { Pressed, Traceable, Traced } from "../../components";
import { stopInput } from "../../lifecycle";
import { record } from "../../pointer";
import { samplePoints, stepPath } from "../../trace";
import type { Config, Point, RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

// ---------------------------------------------------------------------------
// Unit test: the trace gesture. A word grid of 64 x 64 cells with an 8 px gap
// (pitch 72), the geometry of spike P17. Every cell answers `{ cell: index }`,
// so the answer names the path in grid indices.
// ---------------------------------------------------------------------------

/** The side of a cell, in reference px. */
const SIZE = 64;

/** The distance between two cell centres. */
const PITCH = 72;

/** Where the centre of cell 0 sits. */
const ORIGIN = SIZE / 2;

/** One cell of a grid: the entity and its index. */
type Grid = { mock: MockInput; cells: Entity[] };

/**
 * Where the centre of a grid cell sits, in reference px.
 *
 * @param col - The column.
 * @param row - The row.
 * @param dy - A vertical offset off the centre.
 * @returns The point.
 */
function centre(col: number, row: number, dy = 0): Point {
  return { x: ORIGIN + col * PITCH, y: ORIGIN + row * PITCH + dy };
}

/**
 * Spawns a grid of `Traceable` cells, ten per row, with their root boxes and their local hit
 * boxes, and starts the plugin.
 *
 * @param count - How many cells.
 * @param config - Config overrides.
 * @param intentOf - The intent of each cell.
 * @returns The mock and the cells by index.
 */
function grid(
  count: number,
  config: Partial<Config> = {},
  intentOf: (index: number) => string = () => "word"
): Grid {
  const mock = createMockInput(config);
  const cells: Entity[] = [];

  for (let index = 0; index < count; index += 1) {
    const at = centre(index % 10, Math.floor(index / 10));
    const entity = mock.spawn(
      [
        Transform({ x: at.x, y: at.y }),
        Traceable({ intent: intentOf(index), payload: { cell: index } })
      ],
      { projection: "board.cells", key: `c${String(index)}` }
    );

    mock.boxes.push({ entity, x: at.x - ORIGIN, y: at.y - ORIGIN, width: SIZE, height: SIZE });
    mock.setHitBox(entity, { x: -ORIGIN, y: -ORIGIN, width: SIZE, height: SIZE });
    cells.push(entity);
  }

  mock.start();

  return { mock, cells };
}

/**
 * Queues one touch sample at a point and runs one frame.
 *
 * @param mock - The mock plugin.
 * @param kind - The sample kind.
 * @param point - Where the finger is.
 */
function touch(mock: MockInput, kind: RawSample["kind"], point: Point): void {
  record(mock.state, {
    kind,
    pointerType: "touch",
    pointerId: 1,
    clientX: point.x,
    clientY: point.y
  });
  mock.frame();
}

/**
 * Plays a whole trace: a down at the first point, one frame per move, an up at the last point.
 *
 * @param mock - The mock plugin.
 * @param points - The frame points of the finger.
 */
function traceThrough(mock: MockInput, points: readonly Point[]): void {
  const [first = centre(0, 0), ...rest] = points;

  touch(mock, "down", first);
  for (const point of rest) touch(mock, "move", point);
  touch(mock, "up", rest.at(-1) ?? first);
}

/**
 * The cells the one answer names, as grid indices.
 *
 * @param mock - The mock plugin.
 * @returns The indices in path order.
 */
function answeredPath(mock: MockInput): unknown[] {
  expect(mock.answers).toHaveLength(1);

  const payload = mock.answers[0]?.payload as { path: Array<{ cell: number }> };

  return payload.path.map(cell => cell.cell);
}

/**
 * The indices of the cells that carry `Traced`.
 *
 * @param board - The grid.
 * @returns The indices, in grid order.
 */
function tracedCells(board: Grid): number[] {
  return board.cells.flatMap((entity, index) => (board.mock.has(entity, Traced) ? [index] : []));
}

describe("samplePoints", () => {
  it("leaves the start out, ends on the target and walks in equal steps", () => {
    expect(samplePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 32)).toEqual([
      { x: 25, y: 0 },
      { x: 50, y: 0 },
      { x: 75, y: 0 },
      { x: 100, y: 0 }
    ]);
  });

  it("gives the target alone for no move and for a move shorter than one step", () => {
    expect(samplePoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 32)).toEqual([{ x: 5, y: 5 }]);
    expect(samplePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 32)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe("stepPath", () => {
  it("pops the last cell when the finger goes back to the cell before it", () => {
    expect(stepPath([0, 1, 2], 1)).toEqual([0, 1]);
  });

  it("appends a new cell", () => {
    expect(stepPath([0, 1, 2], 3)).toEqual([0, 1, 2, 3]);
  });

  it("ignores an older cell, the last cell and a gap", () => {
    expect(stepPath([0, 1, 2], 0)).toEqual([0, 1, 2]);
    expect(stepPath([0, 1, 2], 2)).toEqual([0, 1, 2]);
    expect(stepPath([0, 1, 2], undefined)).toEqual([0, 1, 2]);
  });

  it("reduces 0, 1, 2, 1, 11, 0 to [0, 1, 11]", () => {
    let path = [0];

    for (const cell of [1, 2, 1, 11, 0]) path = stepPath(path, cell);

    expect(path).toEqual([0, 1, 11]);
  });
});

describe("the trace gesture", () => {
  it("answers a path of one for a down and an up on one cell, and runs no onTap listener", () => {
    const { mock, cells } = grid(3);
    const tapped = vi.fn();

    createInputApi(mock.ctx).onTap(tapped);
    touch(mock, "down", centre(0, 0));

    expect(mock.state.phase).toBe("tracing");
    expect(mock.has(cells[0] ?? 0, Traced)).toBe(true);
    expect(mock.has(cells[0] ?? 0, Pressed)).toBe(false);

    touch(mock, "up", centre(0, 0));

    expect(mock.answers).toEqual([{ intent: "word", payload: { path: [{ cell: 0 }] } }]);
    expect(tapped).not.toHaveBeenCalled();
    expect(mock.state.phase).toBe("idle");
  });

  it("keeps every cell of a fast move from cell 0 to cell 9 in one frame at traceStepPx 32", () => {
    const { mock } = grid(10, { traceStepPx: 32 });

    traceThrough(mock, [centre(0, 0), centre(9, 0)]);

    expect(answeredPath(mock)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("loses cells of the same move at traceStepPx 100, a step longer than the pitch", () => {
    const { mock } = grid(10, { traceStepPx: 100 });

    traceThrough(mock, [centre(0, 0), centre(9, 0)]);

    const path = answeredPath(mock);

    expect(path.length).toBeLessThan(10);
    expect(path[0]).toBe(0);
    expect(path.at(-1)).toBe(9);
  });

  it("stays on a diagonal drawn 20 px off the centre line: the inset circle skips the corners", () => {
    const { mock } = grid(40);

    traceThrough(mock, [centre(0, 0, 20), centre(1, 1, 20), centre(2, 2, 20), centre(3, 3, 20)]);

    expect(answeredPath(mock)).toEqual([0, 11, 22, 33]);
  });

  it("backtracks: 0, 1, 2, 1, 11, 0 answers [0, 1, 11]", () => {
    const { mock } = grid(20);

    traceThrough(mock, [
      centre(0, 0),
      centre(1, 0),
      centre(2, 0),
      centre(1, 0),
      centre(1, 1),
      centre(0, 0)
    ]);

    expect(answeredPath(mock)).toEqual([0, 1, 11]);
  });

  it("moves Traced with the path: a popped cell loses it, and the up clears every tag", () => {
    const board = grid(3);
    const { mock } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    touch(mock, "move", centre(2, 0));

    expect(tracedCells(board)).toEqual([0, 1, 2]);

    touch(mock, "move", centre(1, 0));

    expect(tracedCells(board)).toEqual([0, 1]);

    touch(mock, "up", centre(1, 0));

    expect(tracedCells(board)).toEqual([]);
    expect(answeredPath(mock)).toEqual([0, 1]);
  });

  it("changes nothing for a sample over a gap", () => {
    const board = grid(3);
    const { mock } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", { x: ORIGIN + PITCH / 2, y: ORIGIN });

    expect(mock.state.path).toEqual([board.cells[0]]);
    expect(tracedCells(board)).toEqual([0]);
  });

  it("closes the path on a cell of another intent, warns once, and still answers on the up", () => {
    const board = grid(4, {}, index => (index === 2 ? "bonus" : "word"));
    const { mock } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    touch(mock, "move", centre(2, 0));
    touch(mock, "move", centre(3, 0));
    touch(mock, "move", centre(0, 0));

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("input: trace mixes intents", {
      view: { projection: "board.cells", key: "c2" },
      intent: "bonus"
    });
    expect(tracedCells(board)).toEqual([0, 1]);

    touch(mock, "up", centre(0, 0));

    expect(mock.answers).toEqual([
      { intent: "word", payload: { path: [{ cell: 0 }, { cell: 1 }] } }
    ]);
  });

  it.each([
    ["a pointer cancel", "cancel"],
    ["a lost capture", "lost"]
  ] as const)("answers nothing and leaves no Traced after %s", (_name, kind) => {
    const board = grid(3);
    const { mock } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    touch(mock, kind, centre(1, 0));

    expect(mock.answers).toEqual([]);
    expect(tracedCells(board)).toEqual([]);
    expect(mock.state.phase).toBe("idle");
    expect(mock.calls.at(-1)).toBe("pointer:false");
  });

  it.each([
    "paused",
    "fast"
  ] as const)("lets the trace go with no answer while the world is %s", mode => {
    const board = grid(3);
    const { mock } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    mock.world.mode = mode;
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(tracedCells(board)).toEqual([]);
    expect(mock.state.phase).toBe("idle");
    expect(mock.state.path).toEqual([]);
    expect(mock.calls).toContain("pointer:false");
  });

  it.each([
    ["plays its exit", (mock: MockInput, entity: Entity) => mock.attachTo(entity, Exiting())],
    ["is gone", (mock: MockInput, entity: Entity) => mock.kill(entity)]
  ])("ends the trace with no answer when a cell of the path %s", (_name, leave) => {
    const board = grid(3);
    const { mock, cells } = board;

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    leave(mock, cells[0] ?? 0);
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.answers).toEqual([]);
    expect(mock.has(cells[1] ?? 0, Traced)).toBe(false);

    touch(mock, "up", centre(1, 0));

    expect(mock.answers).toEqual([]);
  });

  it("holds the gate's pointer from the down to the up", () => {
    const { mock } = grid(3);

    touch(mock, "down", centre(0, 0));

    expect(mock.calls).toEqual(["tag:Traced", "pointer:true"]);

    touch(mock, "move", centre(1, 0));
    mock.calls.length = 0;
    touch(mock, "up", centre(1, 0));

    expect(mock.calls).toEqual(["answer", "untag:Traced", "untag:Traced", "pointer:false"]);
  });

  it("leaves no path and no trace field behind on stop", () => {
    const { mock } = grid(3);

    touch(mock, "down", centre(0, 0));
    touch(mock, "move", centre(1, 0));
    stopInput(mock.state);

    expect(mock.state.path).toEqual([]);
    expect(mock.state.traceIntent).toBeUndefined();
    expect(mock.state.traceClosed).toBe(false);
    expect(mock.state.lastPoint).toBeUndefined();
  });
});
