/**
 * @file input plugin — the trace: one finger drawn through many views that carry `Traceable`.
 * The frame step keeps only the last move of a frame, so the segment from the previous frame
 * point is sampled every `traceStepPx` and each sample is hit-tested: a fast finger skips no
 * cell. The path keeps one intent, backs off with the cell before the last, and answers once, on
 * the release. Pure math on reference points: no device clock, no Pixi event.
 */
import { Exiting } from "../world/ecs/define";
import type { Entity } from "../world/types";
import { submit, traceAnswer } from "./answers";
import {
  Draggable,
  type IntentValue,
  Pressable,
  Swipeable,
  Tappable,
  Traceable,
  Traced
} from "./components";
import { findTraced } from "./hit";
import type { InputCtx, Point } from "./types";

/**
 * The points a segment is hit-tested at: equal steps of at most `stepPx`, the start left out, the
 * end always in. A segment with no length is its end alone.
 *
 * @param from - Where the finger was at the last frame.
 * @param to - Where it is now.
 * @param stepPx - The longest step, in reference px.
 * @returns The sample points, from the first step to `to`.
 * @example
 * ```ts
 * samplePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 32);
 * // [{ x: 25, y: 0 }, { x: 50, y: 0 }, { x: 75, y: 0 }, { x: 100, y: 0 }]
 * ```
 */
export function samplePoints(from: Point, to: Point, stepPx: number): Point[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = stepPx > 0 ? Math.max(1, Math.ceil(length / stepPx)) : 1;
  const points: Point[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const at = step / steps;

    points.push({ x: from.x + (to.x - from.x) * at, y: from.y + (to.y - from.y) * at });
  }

  return points;
}

/**
 * Feeds one hit to the path. The cell before the last takes the last one off: the finger backed
 * off. A new cell joins the end. The last cell, an older cell and a gap change nothing.
 *
 * @param path - The cells so far, in path order.
 * @param cell - The cell under the sample, or `undefined` over a gap.
 * @returns The next path, a fresh list.
 * @example
 * ```ts
 * stepPath([0, 1, 2], 1); // [0, 1]
 * stepPath([0, 1, 2], 3); // [0, 1, 2, 3]
 * stepPath([0, 1, 2], 0); // [0, 1, 2]
 * ```
 */
export function stepPath(path: readonly Entity[], cell: Entity | undefined): Entity[] {
  if (cell === undefined || cell === path.at(-1)) return [...path];
  if (cell === path.at(-2)) return path.slice(0, -1);
  if (path.includes(cell)) return [...path];

  return [...path, cell];
}

/**
 * Tells whether a traceable view also carries a gesture the trace takes away.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The pressed cell.
 * @returns True when it also carries `Tappable`, `Pressable`, `Swipeable` or `Draggable`.
 */
function hasOtherGesture(ctx: InputCtx, entity: Entity): boolean {
  const { ecs } = ctx.deps.world;

  return (
    ecs.has(entity, Tappable) ||
    ecs.has(entity, Pressable) ||
    ecs.has(entity, Swipeable) ||
    ecs.has(entity, Draggable)
  );
}

/**
 * Starts a trace on the cell the press hit test found with its full box: it is the first cell of
 * the path and names the intent of the whole trace. The gate learns that a pointer is down, so
 * no `over` node appears mid-trace. A view that also carries another gesture component traces:
 * one warning per press.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The cell under the finger.
 * @param point - Where the finger went down, in reference units.
 */
export function beginTrace(ctx: InputCtx, entity: Entity, point: Point): void {
  const { ecs, projection } = ctx.deps.world;

  if (hasOtherGesture(ctx, entity)) {
    ctx.log.warn("input: Traceable wins", { view: projection.keyOf(entity) });
  }

  ecs.tag(entity, Traced);
  ctx.state.path = [entity];
  ctx.state.traceIntent = ecs.get(entity, Traceable)?.intent;
  ctx.state.traceClosed = false;
  ctx.state.lastPoint = { x: point.x, y: point.y };
  ctx.state.phase = "tracing";
  ctx.deps.flow.gate.pointer(true);
}

/**
 * Hands one sample's cell to the path. A cell of another intent closes the path, with one
 * warning, and stays out of it. On a closed path nothing changes. `Traced` follows the change:
 * a popped cell loses it, a new one gains it.
 *
 * @param ctx - Domain context of the input plugin.
 * @param cell - The cell under the sample, or `undefined` over a gap.
 */
function feedCell(ctx: InputCtx, cell: Entity | undefined): void {
  if (cell === undefined || ctx.state.traceClosed) return;

  const { ecs, projection } = ctx.deps.world;
  const intent = ecs.get(cell, Traceable)?.intent;

  if (intent !== ctx.state.traceIntent) {
    ctx.state.traceClosed = true;
    ctx.log.warn("input: trace mixes intents", { view: projection.keyOf(cell), intent });

    return;
  }

  const before = ctx.state.path;
  const next = stepPath(before, cell);
  const popped = before.at(-1);

  if (next.length < before.length && popped !== undefined) ecs.untag(popped, Traced);
  if (next.length > before.length) ecs.tag(cell, Traced);
  ctx.state.path = next;
}

/**
 * Follows the finger from the last frame point to this one: every sample of the segment is
 * hit-tested with the inset circle and fed to the path, in order.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is now, in reference units.
 */
export function extendTrace(ctx: InputCtx, point: Point): void {
  const from = ctx.state.lastPoint ?? point;

  for (const sample of samplePoints(from, point, ctx.config.traceStepPx)) {
    feedCell(ctx, findTraced(ctx, sample));
  }

  ctx.state.lastPoint = { x: point.x, y: point.y };
}

/**
 * The finger let go: the segment to the release point is sampled, then the path is answered
 * once, with the `Traceable` of every cell read now, in path order. The tags go and the gate
 * learns the pointer is up.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger let go, in reference units.
 * @returns Whether the gate took the answer.
 */
export function endTrace(ctx: InputCtx, point: Point): boolean {
  extendTrace(ctx, point);

  const { ecs } = ctx.deps.world;
  const [first] = ctx.state.path;
  const cells: IntentValue[] = [];

  for (const cell of ctx.state.path) {
    const value = ecs.get(cell, Traceable);

    if (value !== undefined) cells.push(value);
  }

  const accepted = first !== undefined && submit(ctx, first, traceAnswer(cells));

  abortTrace(ctx);

  return accepted;
}

/**
 * Ends the trace with no answer: a cancel, a lost capture, a world that stands still or runs
 * fast, and a cell that left the board. Every `Traced` tag goes, the path is forgotten and the
 * gate learns the pointer is up.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function abortTrace(ctx: InputCtx): void {
  const { ecs } = ctx.deps.world;

  for (const cell of ctx.state.path) if (ecs.has(cell, Traced)) ecs.untag(cell, Traced);
  ctx.state.path = [];
  ctx.state.traceIntent = undefined;
  ctx.state.traceClosed = false;
  ctx.state.lastPoint = undefined;
  ctx.deps.flow.gate.pointer(false);
}

/**
 * Tells whether the board changed under the finger: a cell of the path is gone or plays its
 * exit. The frame step then ends the trace with no answer.
 *
 * @param ctx - Domain context of the input plugin.
 * @returns True when a cell of the path left.
 */
export function traceLost(ctx: InputCtx): boolean {
  const { ecs } = ctx.deps.world;

  return ctx.state.path.some(cell => !ecs.has(cell, Traceable) || ecs.has(cell, Exiting));
}
