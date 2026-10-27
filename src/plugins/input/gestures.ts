/**
 * @file input plugin — the gesture machine. The DOM handlers queue raw samples; the machine
 * drains them in `time.onFrame("input")`, and a down, an up and a cancel of a live world at their
 * event (`resolveEarly`): a move waits for the frame step. No `Date.now`, no `performance.now`, no
 * `event.timeStamp`: every duration is a sum of `time.delta`, so `time.step(dt)` drives the
 * machine in a test and a time scale or a pause applies to it.
 */
import { Transform } from "../renderer/components";
import type { Time } from "../time/types";
import { Exiting } from "../world/ecs/define";
import type { Entity } from "../world/types";
import { notifyTap, submit, submitBlocked, swipeAnswer, tapAnswer } from "./answers";
import {
  Draggable,
  Pointer,
  type PointerValue,
  Pressable,
  Pressed,
  type ScrollableValue,
  Swipeable,
  Tappable,
  Traceable
} from "./components";
import { abortDrag, grab, letGoOfLeavers, moveHeld, moveHover, release } from "./drag";
import { findPressed, lockedOut, movingScrollOf, scrollOnAxisOf } from "./hit";
import { clearPointerOver, endsHover, isHover, movePointerOver, syncCursor } from "./hover";
import { attach, detach, record } from "./pointer";
import { abortTrace, beginTrace, endTrace, extendTrace, traceLost } from "./trace";
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
 * The axis a pan moves on: the dominant one, horizontal on an exact diagonal.
 *
 * @param from - Where the press started.
 * @param to - Where the finger is.
 * @returns The axis of the larger move.
 * @example
 * ```ts
 * axisOf({ x: 0, y: 0 }, { x: 20, y: -5 }); // "x"
 * ```
 */
function axisOf(from: Point, to: Point): ScrollableValue["axis"] {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? "x" : "y";
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
 * pointer, whether it moved or caught a scroll, the entity and its key.
 *
 * @param ctx - Domain context of the input plugin.
 */
function toIdle(ctx: InputCtx): void {
  const { entity } = ctx.state;

  if (entity !== undefined) ctx.deps.world.ecs.untag(entity, Pressed);
  capture(ctx, false);
  ctx.state.phase = "idle";
  ctx.state.pointerId = undefined;
  ctx.state.moved = false;
  ctx.state.caught = false;
  ctx.state.entity = undefined;
  ctx.state.key = undefined;
  ctx.state.pressedMs = 0;
}

/**
 * Makes a view the pressed one: it is remembered with its projection key and tagged `Pressed`.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view that takes the press.
 */
function press(ctx: InputCtx, entity: Entity): void {
  ctx.state.entity = entity;
  ctx.state.key = ctx.deps.world.projection.keyOf(entity);
  ctx.deps.world.ecs.tag(entity, Pressed);
}

/**
 * Takes the pointer and looks for the view under it. The pointer is taken even where no view is.
 * While the finger rests (`rests`) the next finger that goes down takes the pointer over and this
 * press is cancelled; once it starts a gesture — a drag, a move past the tap slop, a long press, a
 * trace — a second finger stays ignored. When the view under the finger sits in a moving scroll,
 * that scroll takes the press: the finger stops it, and the press is caught. A view drawn over a
 * moving scroll from another root, a HUD or a popup button, keeps its press. A view that carries
 * `Traceable` starts a trace instead of a press: it is not tagged `Pressed`. A press outside the
 * window of a guide's lock reaches no view: it answers the guide's `blocked`, or nothing, and its
 * release answers nothing more.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param point - Where the finger went down, in reference units.
 * @param sample - The raw sample.
 */
function onDown(ctx: InputCtx, pointer: PointerValue, point: Point, sample: RawSample): void {
  const { ecs } = ctx.deps.world;

  ctx.state.pointerId = sample.pointerId;
  ctx.state.moved = false;
  ctx.state.caught = false;
  ctx.state.start = { x: point.x, y: point.y };
  ctx.state.pressedMs = 0;
  ctx.state.phase = "pressed";
  pointer.down = true;
  pointer.justPressed = true;
  capture(ctx, true);

  // Checked here, before `findPressed` (which also finds nothing there): an empty spot inside the
  // window must stay a plain press on nothing, only a locked point answers the guide's `blocked`.
  if (lockedOut(ctx.state, point.x, point.y)) {
    submitBlocked(ctx);

    return;
  }

  const entity = findPressed(ctx, point.x, point.y);

  if (entity === undefined) return;

  const scroll = movingScrollOf(ctx, entity);

  if (scroll !== undefined) {
    ctx.state.caught = true;
    press(ctx, scroll);

    return;
  }

  if (ecs.has(entity, Traceable)) {
    beginTrace(ctx, entity, point);

    return;
  }

  press(ctx, entity);

  if (ecs.has(entity, Draggable) && ecs.has(entity, Swipeable)) {
    ctx.log.warn("input: Draggable wins over Swipeable", { view: ctx.state.key });
  }
}

/**
 * The press just left the tap slop: it goes to the scroll it pans, the innermost `Scrollable` of
 * the pressed view's own `Parent` chain (the view itself included) that moves on the dominant axis
 * of the move. The view loses `Pressed`, and the press is marked caught: it is a scroll gesture
 * now, so its release answers nothing, also when the finger came back inside the slop. A
 * draggable or swipeable view keeps its gesture, a caught press keeps its scroll, and a view that
 * sits in no scroll of that axis keeps its press, also a popup button drawn over a list.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is, in reference units.
 */
function handOff(ctx: InputCtx, point: Point): void {
  const { caught, entity, start } = ctx.state;
  const { ecs } = ctx.deps.world;

  if (entity === undefined || caught) return;
  if (ecs.has(entity, Draggable) || ecs.has(entity, Swipeable)) return;

  const scroll = scrollOnAxisOf(ctx, entity, axisOf(start, point));

  if (scroll === undefined || scroll === entity) return;

  ecs.untag(entity, Pressed);
  ctx.state.caught = true;
  press(ctx, scroll);
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
 * went far enough and fast enough. Neither: nothing happened, and nothing has to be undone. Every
 * release inside the slop runs the `onTap` listeners first, so a view that carries only
 * `Touchable` is heard although it answers nothing. A caught press belongs to a scroll — it
 * stopped a moving one or was handed to one — and answers nothing and runs no listener.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The pressed view.
 * @param point - Where the finger let go, in reference units.
 */
function answerRelease(ctx: InputCtx, entity: Entity, point: Point): void {
  if (ctx.state.caught) return;

  const { ecs } = ctx.deps.world;
  const travelled = distance(ctx.state.start, point);

  if (travelled <= ctx.config.tapSlopPx) {
    notifyTap(ctx, entity);

    const tappable = ecs.get(entity, Tappable);

    if (tappable !== undefined) {
      submit(ctx, entity, tapAnswer(tappable));

      return;
    }
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
 * The finger let go: a drag is released over whatever is under it, a trace answers its path, a
 * press is answered, a long press is already done and answers nothing more.
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
  else if (phase === "tracing") endTrace(ctx, point);
  else if (phase === "pressed" && entity !== undefined) answerRelease(ctx, entity, point);

  toIdle(ctx);
}

/**
 * The gesture was taken away: `pointercancel`, or the capture was lost. A drag is released with
 * no target, so the view settles home; a trace forgets its path; a press just lets go. Nothing
 * is answered.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 */
function onCancel(ctx: InputCtx, pointer: PointerValue): void {
  pointer.down = false;
  letGestureGo(ctx);
  toIdle(ctx);
}

/**
 * Lets a running drag or trace go with no answer: the drag is released with no target, so the
 * stack settles home, and the trace drops its `Traced` tags.
 *
 * @param ctx - Domain context of the input plugin.
 */
function letGestureGo(ctx: InputCtx): void {
  if (ctx.state.phase === "dragging") release(ctx);
  if (ctx.state.phase === "tracing") abortTrace(ctx);
}

/**
 * Tells whether the followed pointer has not started a gesture: pressed, still inside the tap
 * slop, no long press, no trace. Only such a pointer gives way to another finger, wherever it
 * rests; a drag, a pan past the slop, a long press and a trace keep the pointer.
 *
 * @param ctx - Domain context of the input plugin.
 * @returns True while the followed pointer rests.
 */
function rests(ctx: InputCtx): boolean {
  return ctx.state.phase === "pressed" && !ctx.state.moved;
}

/**
 * Tells whether a sample takes the press past the tap slop for the first time: the press has not
 * moved yet and the finger is farther than `tapSlopPx` from the start.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is, in reference units.
 * @returns True in the one sample that turns the press into a moved one.
 */
function leavesSlop(ctx: InputCtx, point: Point): boolean {
  return (
    ctx.state.phase === "pressed" &&
    !ctx.state.moved &&
    distance(ctx.state.start, point) > ctx.config.tapSlopPx
  );
}

/**
 * Feeds one raw sample to the machine. A leave does nothing here. A sample of another pointer is
 * dropped while a pointer is followed: the second finger is ignored. One exception: a press while
 * the followed pointer rests takes the pointer over and cancels the resting press, so a resting
 * thumb or palm never blocks the finger that plays. A move of an idle mouse or pen hit-tests
 * nothing: its point is returned, so the drain moves the hover once per frame. A move of a press
 * past the tap slop marks the press as moved for good and, in that one sample, hands it to the
 * scroll it pans. A lost capture ends the gesture like a cancel.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param sample - The raw sample.
 * @returns The hover point of an idle move, otherwise `undefined`.
 */
function handleSample(ctx: InputCtx, pointer: PointerValue, sample: RawSample): Point | undefined {
  const { pointerId } = ctx.state;

  if (sample.kind === "leave") return undefined;
  if (pointerId !== undefined && pointerId !== sample.pointerId) {
    if (sample.kind !== "down" || !rests(ctx)) return undefined;
    // The resting pointer gives way: its press is cancelled (no answer), its capture released,
    // the machine forgets it.
    toIdle(ctx);
  }

  const point = ctx.deps.renderer.viewport.toReference(sample.clientX, sample.clientY);

  pointer.x = point.x;
  pointer.y = point.y;

  switch (sample.kind) {
    case "down": {
      onDown(ctx, pointer, point, sample);
      break;
    }
    case "move": {
      if (isHover(ctx, pointer, sample)) return point;
      if (leavesSlop(ctx, point)) {
        ctx.state.moved = true;
        handOff(ctx, point);
      }
      if (ctx.state.phase === "tracing") extendTrace(ctx, point);
      else onMove(ctx, point);
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

  return undefined;
}

/**
 * Feeds the queued samples of one frame to the machine, in order. A touch, a cancel and a canvas
 * leave end the hover whichever pointer sent them, and drop the hover point seen so far. Only the
 * last hover point of the frame is hit-tested: a fast mouse or pen queues several moves per frame
 * and only the last one is visible.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param queue - The samples queued since the last frame.
 */
function drainSamples(ctx: InputCtx, pointer: PointerValue, queue: readonly RawSample[]): void {
  let hover: Point | undefined;

  for (const sample of queue) {
    if (endsHover(sample)) {
      clearPointerOver(ctx);
      hover = undefined;
    }
    hover = handleSample(ctx, pointer, sample) ?? hover;
  }

  if (hover !== undefined) movePointerOver(ctx, hover);
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
 * The per-frame half of a running drag: a held view that left or is playing its exit ends the
 * drag, a carried view that left is let go, and the held view follows the finger with the rest
 * of the stack while the hover tag moves with it.
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

  letGoOfLeavers(ctx);
  moveHeld(ctx, pointer);
  moveHover(ctx, pointer);
}

/**
 * The per-frame half of a running trace: a cell of the path that left or is playing its exit
 * means the board changed under the finger, so the trace ends with no answer.
 *
 * @param ctx - Domain context of the input plugin.
 */
function followTrace(ctx: InputCtx): void {
  if (!traceLost(ctx)) return;

  abortTrace(ctx);
  toIdle(ctx);
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
      pointerType: "mouse",
      pointerId: ctx.state.pointerId ?? 0,
      clientX: 0,
      clientY: 0
    });
  }

  ctx.state.canvas = canvas;
  if (canvas !== undefined) attach(canvas, ctx);
}

/**
 * The world stands still: the queued samples are dropped, a running drag ends as a cancel, a
 * running trace ends with no answer, the hover goes and the pointer is reported up. A settle written in this mode lands as the rest pose
 * at once.
 *
 * @param ctx - Domain context of the input plugin.
 */
function pauseGestures(ctx: InputCtx): void {
  const pointer = ctx.deps.world.ecs.resource(Pointer);

  ctx.state.samples = [];
  ctx.state.resolvedEarly = false;
  clearPointerOver(ctx);
  letGestureGo(ctx);
  pointer.down = false;
  pointer.justPressed = false;
  pointer.justReleased = false;
  pointer.id = -1;
  toIdle(ctx);
}

/**
 * Clears `justPressed` and `justReleased` of the `Pointer` resource: they tell one frame of a press or a release.
 *
 * @param pointer - The `Pointer` resource.
 */
function clearJust(pointer: PointerValue): void {
  pointer.justPressed = false;
  pointer.justReleased = false;
}

/**
 * Resolves the queued samples at the DOM event of a down, an up or a cancel, between two frames
 * (F61): the pressed view is tagged and a release answers the gate now, so the press look starts
 * in the next frame and a node that awaits nothing commits before it. The first resolve after a
 * frame clears that frame's flags; the next frame step keeps the ones it wrote. Only a live world
 * resolves early: fast and paused leave the samples to the frame step, as before.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function resolveEarly(ctx: InputCtx): void {
  if (ctx.deps.world.ecs.mode() !== "live") return;

  const pointer = ctx.deps.world.ecs.resource(Pointer);
  const queue = ctx.state.samples;

  if (!ctx.state.resolvedEarly) {
    clearJust(pointer);
    ctx.state.resolvedEarly = true;
  }

  ctx.state.samples = [];
  drainSamples(ctx, pointer, queue);
  syncCursor(ctx);
  pointer.id = ctx.state.pointerId ?? -1;
}

/**
 * The one frame step of the plugin, registered with `time.onFrame("input")` in `onInit`, so it
 * runs before the `world` callback of the same phase: `Pointer`, `Held`, `Hovered` and `Pressed`
 * are fresh when game systems of phase `input` read them.
 * The canvas cursor is set right after the hover. `Pointer.id` is written last, once per step: the
 * followed `pointerId`, `-1` when no pointer is followed.
 *
 * @param ctx - Domain context of the input plugin.
 * @param time - The frame's `Time`.
 */
export function stepGestures(ctx: InputCtx, time: Readonly<Time>): void {
  syncCanvas(ctx);

  const mode = ctx.deps.world.ecs.mode();

  if (mode === "fast") {
    ctx.state.samples = [];
    // A press drained at its event before the mode turned keeps no flags for a later live step.
    ctx.state.resolvedEarly = false;

    // A gesture that was running when the mode turned fast is let go like a cancel. Leaving it
    // would leak `Held`, the mute, the lift and a pointer the gate believes is still down. With
    // nothing in the hand nothing at all is written, which is what fast mode promises.
    if (ctx.state.phase !== "idle") pauseGestures(ctx);

    return;
  }

  if (mode === "paused") {
    pauseGestures(ctx);
    syncCursor(ctx);

    return;
  }

  const pointer = ctx.deps.world.ecs.resource(Pointer);
  const queue = ctx.state.samples;

  // A press resolved at its event wrote the flags this frame's systems read: they stay until the next step.
  if (ctx.state.resolvedEarly) ctx.state.resolvedEarly = false;
  else clearJust(pointer);

  ctx.state.samples = [];
  drainSamples(ctx, pointer, queue);
  syncCursor(ctx);

  advanceTime(ctx, pointer, time.delta);
  if (ctx.state.phase === "dragging") followDrag(ctx, pointer);
  if (ctx.state.phase === "tracing") followTrace(ctx);
  pointer.id = ctx.state.pointerId ?? -1;
}
