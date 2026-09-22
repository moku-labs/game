/**
 * @file input plugin — the one frame step. The DOM handlers only queue raw samples; every
 * decision is made here, in `time.onFrame("input")`. No `Date.now`, no `performance.now`, no
 * `event.timeStamp`: every duration is a sum of `time.delta`, so `time.step(dt)` drives the
 * machine in a test and a time scale or a pause applies to it.
 */
import { Transform } from "../renderer/components";
import type { Time } from "../time/types";
import { Exiting } from "../world/ecs/define";
import type { Entity } from "../world/types";
import { submit, swipeAnswer, tapAnswer } from "./answers";
import {
  Draggable,
  Pointer,
  type PointerValue,
  Pressable,
  Pressed,
  Swipeable,
  Tappable
} from "./components";
import { abortDrag, grab, moveHeld, moveHover, release } from "./drag";
import { findPressed } from "./hit";
import { attach, detach, record } from "./pointer";
import type { Direction, InputCtx, Point, RawSample } from "./types";

/**
 * The straight-line distance between two points, in reference px.
 *
 * @param from - Where the gesture started.
 * @param to - Where the finger is.
 * @returns The distance in reference px.
 * @example
 * ```ts
 * distance({ x: 0, y: 0 }, { x: 3, y: 4 }); // 5
 * ```
 */
export function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * The dominant axis of a move. A move that is exactly diagonal counts as horizontal.
 *
 * @param from - Where the gesture started.
 * @param to - Where the finger let go.
 * @returns Which way the swipe went.
 * @example
 * ```ts
 * direction({ x: 0, y: 0 }, { x: 10, y: -100 }); // "up"
 * ```
 */
export function direction(from: Point, to: Point): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";

  return dy >= 0 ? "down" : "up";
}

/**
 * Takes or releases the pointer capture of the canvas. A pointer that is already gone — a down
 * and an up inside one frame — cannot be captured; the browser throws and the gesture goes on.
 *
 * @param ctx - Domain context of the input plugin.
 * @param on - True to capture, false to release.
 */
function capture(ctx: InputCtx, on: boolean): void {
  const { canvas, pointerId } = ctx.state;

  if (canvas === undefined || pointerId === undefined) return;

  try {
    if (on) canvas.setPointerCapture(pointerId);
    else canvas.releasePointerCapture(pointerId);
  } catch (error) {
    ctx.log.debug("input: the pointer cannot be captured", { error });
  }
}

/**
 * Ends the gesture: the press tag goes, the capture is released and the machine forgets the
 * pointer, the entity and its key.
 *
 * @param ctx - Domain context of the input plugin.
 */
function toIdle(ctx: InputCtx): void {
  const { entity } = ctx.state;

  if (entity !== undefined) ctx.deps.world.ecs.untag(entity, Pressed);
  capture(ctx, false);
  ctx.state.phase = "idle";
  ctx.state.pointerId = undefined;
  ctx.state.entity = undefined;
  ctx.state.key = undefined;
  ctx.state.pressedMs = 0;
}

/**
 * Takes the pointer and looks for the view under it. The pointer is taken even where no view is,
 * so a second finger stays ignored for the whole gesture.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param point - Where the finger went down, in reference units.
 * @param sample - The raw sample.
 */
function onDown(ctx: InputCtx, pointer: PointerValue, point: Point, sample: RawSample): void {
  const { ecs, projection } = ctx.deps.world;

  ctx.state.pointerId = sample.pointerId;
  ctx.state.start = { x: point.x, y: point.y };
  ctx.state.pressedMs = 0;
  ctx.state.phase = "pressed";
  pointer.down = true;
  pointer.justPressed = true;
  capture(ctx, true);

  const entity = findPressed(ctx, point.x, point.y);

  if (entity === undefined) return;

  ctx.state.entity = entity;
  ctx.state.key = projection.keyOf(entity);
  ecs.tag(entity, Pressed);

  if (ecs.has(entity, Draggable) && ecs.has(entity, Swipeable)) {
    ctx.log.warn("input: Draggable wins over Swipeable", { view: ctx.state.key });
  }
}

/**
 * Turns a press on a draggable view into a drag once the finger left the start by more than
 * `dragStartPx`. A draggable view with no projection key cannot be carried: `mute`, `lift` and
 * `settle` belong to a projection, so the gesture is reported and given up.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is, in reference units.
 */
function onMove(ctx: InputCtx, point: Point): void {
  const { entity, phase, start } = ctx.state;

  if (phase !== "pressed" || entity === undefined) return;
  if (!ctx.deps.world.ecs.has(entity, Draggable)) return;
  if (distance(start, point) <= ctx.config.dragStartPx) return;

  ctx.deps.world.ecs.untag(entity, Pressed);

  if (ctx.state.key === undefined) {
    ctx.log.warn("input: draggable view has no projection key", { entity });
    toIdle(ctx);

    return;
  }

  grab(ctx, entity, point);
  ctx.state.phase = "dragging";
}

/**
 * Answers the release of a press: a tap when the finger stayed inside the slop, a swipe when it
 * went far enough and fast enough. Neither: nothing happened, and nothing has to be undone.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The pressed view.
 * @param point - Where the finger let go, in reference units.
 */
function answerRelease(ctx: InputCtx, entity: Entity, point: Point): void {
  const { ecs } = ctx.deps.world;
  const travelled = distance(ctx.state.start, point);
  const tappable = ecs.get(entity, Tappable);

  if (tappable !== undefined && travelled <= ctx.config.tapSlopPx) {
    submit(ctx, entity, tapAnswer(tappable));

    return;
  }

  const swipeable = ecs.get(entity, Swipeable);

  if (
    swipeable === undefined ||
    travelled < ctx.config.swipeMinPx ||
    ctx.state.pressedMs > ctx.config.swipeMaxMs
  ) {
    return;
  }

  submit(ctx, entity, swipeAnswer(swipeable, direction(ctx.state.start, point)));
}

/**
 * The finger let go: a drag is released over whatever is under it, a press is answered, a long
 * press is already done and answers nothing more.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param point - Where the finger let go, in reference units.
 */
function onUp(ctx: InputCtx, pointer: PointerValue, point: Point): void {
  const { entity, phase } = ctx.state;

  pointer.down = false;
  pointer.justReleased = true;

  if (phase === "dragging") release(ctx, point);
  else if (phase === "pressed" && entity !== undefined) answerRelease(ctx, entity, point);

  toIdle(ctx);
}

/**
 * The gesture was taken away: `pointercancel`, or the capture was lost. A drag is released with
 * no target, so the view settles home; a press just lets go. Nothing is answered.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 */
function onCancel(ctx: InputCtx, pointer: PointerValue): void {
  pointer.down = false;
  if (ctx.state.phase === "dragging") release(ctx);
  toIdle(ctx);
}

/**
 * Feeds one raw sample to the machine. A sample of another pointer is dropped while a pointer is
 * active: the second finger is ignored.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param sample - The raw sample.
 */
function handleSample(ctx: InputCtx, pointer: PointerValue, sample: RawSample): void {
  const { pointerId } = ctx.state;

  if (pointerId !== undefined && pointerId !== sample.pointerId) return;

  const point = ctx.deps.renderer.viewport.toReference(sample.clientX, sample.clientY);

  pointer.x = point.x;
  pointer.y = point.y;

  switch (sample.kind) {
    case "down": {
      onDown(ctx, pointer, point, sample);
      break;
    }
    case "move": {
      onMove(ctx, point);
      break;
    }
    case "up": {
      onUp(ctx, pointer, point);
      break;
    }
    default: {
      onCancel(ctx, pointer);
    }
  }
}

/**
 * The time rule of a press: a `Pressable` held for `longPressMs` without leaving the slop answers
 * at once, and its release is not a tap.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param deltaMs - The frame delta in game milliseconds.
 */
function advanceTime(ctx: InputCtx, pointer: PointerValue, deltaMs: number): void {
  const { entity } = ctx.state;

  if (ctx.state.phase !== "pressed") return;

  ctx.state.pressedMs += deltaMs;
  if (entity === undefined) return;

  const pressable = ctx.deps.world.ecs.get(entity, Pressable);

  if (pressable === undefined || ctx.state.pressedMs < ctx.config.longPressMs) return;
  if (distance(ctx.state.start, pointer) > ctx.config.tapSlopPx) return;

  submit(ctx, entity, tapAnswer(pressable));
  ctx.deps.world.ecs.untag(entity, Pressed);
  ctx.state.phase = "longPressed";
}

/**
 * The per-frame half of a running drag: a view that left or is playing its exit ends the drag,
 * otherwise the held view follows the finger and the hover tag moves with it.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 */
function followDrag(ctx: InputCtx, pointer: PointerValue): void {
  const { entity } = ctx.state;

  if (entity === undefined) return;

  const { ecs } = ctx.deps.world;

  if (!ecs.has(entity, Transform) || ecs.has(entity, Exiting)) {
    abortDrag(ctx);
    toIdle(ctx);

    return;
  }

  moveHeld(ctx, pointer);
  moveHover(ctx, pointer);
}

/**
 * Step 0 of the frame: a canvas that differs from the attached one is a device restore, or the
 * loss of the screen. The listeners move with it and a gesture in progress is cancelled, so a
 * drag settles home instead of hanging on a canvas nobody draws on.
 *
 * @param ctx - Domain context of the input plugin.
 */
function syncCanvas(ctx: InputCtx): void {
  const canvas = ctx.deps.renderer.host.canvas();

  if (canvas === ctx.state.canvas) return;

  detach(ctx.state);
  if (ctx.state.phase !== "idle") {
    record(ctx.state, {
      kind: "cancel",
      pointerId: ctx.state.pointerId ?? 0,
      clientX: 0,
      clientY: 0
    });
  }

  ctx.state.canvas = canvas;
  if (canvas !== undefined) attach(canvas, ctx.state);
}

/**
 * The world stands still: the queued samples are dropped, a running drag ends as a cancel and the
 * pointer is reported up. A settle written in this mode lands as the rest pose at once.
 *
 * @param ctx - Domain context of the input plugin.
 */
function pauseGestures(ctx: InputCtx): void {
  const pointer = ctx.deps.world.ecs.resource(Pointer);

  ctx.state.samples = [];
  if (ctx.state.phase === "dragging") release(ctx);
  pointer.down = false;
  pointer.justPressed = false;
  pointer.justReleased = false;
  toIdle(ctx);
}

/**
 * The one frame step of the plugin, registered with `time.onFrame("input")` in `onInit`, so it
 * runs before the `world` callback of the same phase: `Pointer`, `Held`, `Hovered` and `Pressed`
 * are fresh when game systems of phase `input` read them.
 *
 * @param ctx - Domain context of the input plugin.
 * @param time - The frame's `Time`.
 */
export function stepGestures(ctx: InputCtx, time: Readonly<Time>): void {
  syncCanvas(ctx);

  const mode = ctx.deps.world.ecs.mode();

  if (mode === "fast") {
    ctx.state.samples = [];

    // A gesture that was running when the mode turned fast is let go like a cancel. Leaving it
    // would leak `Held`, the mute, the lift and a pointer the gate believes is still down. With
    // nothing in the hand nothing at all is written, which is what fast mode promises.
    if (ctx.state.phase !== "idle") pauseGestures(ctx);

    return;
  }

  if (mode === "paused") {
    pauseGestures(ctx);

    return;
  }

  const pointer = ctx.deps.world.ecs.resource(Pointer);
  const queue = ctx.state.samples;

  pointer.justPressed = false;
  pointer.justReleased = false;
  ctx.state.samples = [];
  for (const sample of queue) handleSample(ctx, pointer, sample);

  advanceTime(ctx, pointer, time.delta);
  if (ctx.state.phase === "dragging") followDrag(ctx, pointer);
}
