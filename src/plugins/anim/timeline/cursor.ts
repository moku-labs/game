/**
 * @file anim/timeline — the cursor over a step tree: one mutable record per step, the advance
 * that carries the remainder of a finished step into the next one of the same frame, and the two
 * ways out. It reaches the world only through the injected runtime.
 */
import { Sprite } from "../../renderer/components";
import type { Entity } from "../../world/types";
import { asComponent } from "../components";
import type { StepMotion } from "../tween/types";
import { frameIndexAt, framesDurationMs, writeFrame } from "./frames";
import type { Cursor, CursorCtx, Step, TimelineRuntime } from "./types";

/** A `frames` cursor starts before its first key, so the first advance always writes one. */
const BEFORE_FIRST_FRAME = -1;

/**
 * Builds the cursor records of one step and of everything under it.
 *
 * @param step - The step tree the timeline plays.
 * @returns The root cursor.
 */
export function createCursor(step: Step): Cursor {
  return {
    step,
    children: childrenOf(step),
    index: step.kind === "frames" ? BEFORE_FIRST_FRAME : 0,
    elapsed: 0,
    motion: undefined,
    started: false,
    ended: false
  };
}

/**
 * The cursors of the children of one step.
 *
 * @param step - The step to look into.
 * @returns One cursor per child, empty for a leaf.
 */
function childrenOf(step: Step): readonly Cursor[] {
  if (step.kind === "sequence" || step.kind === "parallel") {
    return step.steps.map(child => createCursor(child));
  }

  if (step.kind === "use") return [createCursor(step.step)];

  return [];
}

/**
 * Reports one mark: to the timeline's own list and to the runtime, which emits the event and
 * calls the `onMark` listeners.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param name - Name of the mark.
 */
function reportMark(cctx: CursorCtx, name: string): void {
  cctx.marks.push(name);
  cctx.rt.mark(cctx.animation, name);
}

/**
 * Resolves the target of a step to a live entity that carries the component.
 *
 * @param rt - The timeline runtime.
 * @param step - A step that names a target and a component.
 * @returns The entity, or `undefined` when the step has nothing to write.
 */
function targetOf(
  rt: TimelineRuntime,
  step: Extract<Step, { kind: "tween" | "set" }>
): Entity | undefined {
  const entity = rt.entityOf(step.target);

  if (entity === undefined || rt.read(entity, step.component) === undefined) return undefined;

  return entity;
}

/**
 * Resolves the target of a `frames` step to a live entity that carries a `Sprite`.
 *
 * @param rt - The timeline runtime.
 * @param step - The frames step.
 * @returns The entity, or `undefined`.
 */
function spriteOf(
  rt: TimelineRuntime,
  step: Extract<Step, { kind: "frames" }>
): Entity | undefined {
  const entity = rt.entityOf(step.target);

  if (entity === undefined || rt.read(entity, asComponent(Sprite)) === undefined) return undefined;

  return entity;
}

/**
 * Starts the track of a `tween` step.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The tween step.
 * @returns The motion, or `undefined` when the target is not there.
 */
function startTween(
  cctx: CursorCtx,
  step: Extract<Step, { kind: "tween" }>
): StepMotion | undefined {
  const entity = targetOf(cctx.rt, step);

  if (entity === undefined) return undefined;

  return cctx.rt.start(
    entity,
    step.component,
    { ...step.to },
    { ms: step.ms, ease: step.ease, delayMs: step.delayMs, additive: step.additive }
  );
}

/**
 * Writes the patch of a `set` step, or the target of a `tween` step that never started.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The step to write.
 * @param patch - The fields to write.
 */
function writeStep(
  cctx: CursorCtx,
  step: Extract<Step, { kind: "tween" | "set" }>,
  patch: Record<string, unknown>
): void {
  const entity = targetOf(cctx.rt, step);

  if (entity !== undefined) cctx.rt.write(entity, step.component, patch);
}

/**
 * Advances a `sequence`: its current child, then the next one with whatever time was left over.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The sequence cursor.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the sequence.
 */
function advanceSequence(cctx: CursorCtx, cursor: Cursor, deltaMs: number): number {
  let left = deltaMs;

  while (cursor.index < cursor.children.length) {
    const child = cursor.children[cursor.index];

    if (child === undefined) break;

    const rest = advanceCursor(cctx, child, left);

    if (!child.ended) return 0;

    cursor.index += 1;
    left = rest;
  }

  cursor.ended = true;

  return left;
}

/**
 * Advances a `parallel`: every child that still runs, and it ends with the longest one.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The parallel cursor.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the last child.
 */
function advanceParallel(cctx: CursorCtx, cursor: Cursor, deltaMs: number): number {
  let left = deltaMs;
  let running = false;

  for (const child of cursor.children) {
    if (child.ended) continue;

    const rest = advanceCursor(cctx, child, deltaMs);

    if (child.ended) left = Math.min(left, rest);
    else running = true;
  }

  if (running) return 0;

  cursor.ended = true;

  return left;
}

/**
 * Advances a `use`: the nested tree, whose marks are reported under the nested id.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The use cursor.
 * @param id - Id of the nested animation.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the nested tree.
 */
function advanceUse(cctx: CursorCtx, cursor: Cursor, id: string, deltaMs: number): number {
  const child = cursor.children[0];

  if (child === undefined) {
    cursor.ended = true;

    return deltaMs;
  }

  const rest = advanceCursor({ ...cctx, animation: id }, child, deltaMs);

  if (!child.ended) return 0;

  cursor.ended = true;

  return rest;
}

/**
 * Advances a `wait`.
 *
 * @param cursor - The wait cursor.
 * @param durationMs - How long the step waits.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the wait.
 */
function advanceWait(cursor: Cursor, durationMs: number, deltaMs: number): number {
  cursor.elapsed += deltaMs;

  if (cursor.elapsed < durationMs) return 0;

  cursor.ended = true;

  return cursor.elapsed - durationMs;
}

/**
 * Advances a `tween`: the first frame resolves the target and starts the track, every frame after
 * it hands the track its delta.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The tween cursor.
 * @param step - The tween step.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the track.
 */
function advanceTween(
  cctx: CursorCtx,
  cursor: Cursor,
  step: Extract<Step, { kind: "tween" }>,
  deltaMs: number
): number {
  if (!cursor.started) {
    cursor.started = true;
    cursor.motion = startTween(cctx, step);
  }

  const motion = cursor.motion;

  if (motion === undefined) {
    cursor.ended = true;

    return deltaMs;
  }

  const rest = motion.advance(deltaMs);

  if (motion.active()) return 0;

  cursor.ended = true;

  return rest;
}

/**
 * Advances a `frames` step: it writes the key the elapsed time landed on, and ends after the last
 * one unless the list loops.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The frames cursor.
 * @param step - The frames step.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the list.
 */
function advanceFrames(
  cctx: CursorCtx,
  cursor: Cursor,
  step: Extract<Step, { kind: "frames" }>,
  deltaMs: number
): number {
  const entity = step.keys.length === 0 ? undefined : spriteOf(cctx.rt, step);

  if (entity === undefined) {
    cursor.ended = true;

    return deltaMs;
  }

  cursor.elapsed += deltaMs;

  const index = frameIndexAt(step.keys, step.fps, step.loop, cursor.elapsed);
  const key = step.keys[index];

  if (index !== cursor.index && key !== undefined) {
    cursor.index = index;
    writeFrame(cctx.rt, entity, key);
  }

  const total = framesDurationMs(step.keys, step.fps);

  if (step.loop || cursor.elapsed < total) return 0;

  cursor.ended = true;

  return cursor.elapsed - total;
}

/**
 * Advances one step of a running timeline.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The cursor of the step.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the step.
 */
export function advanceCursor(cctx: CursorCtx, cursor: Cursor, deltaMs: number): number {
  if (cursor.ended) return deltaMs;

  const step = cursor.step;

  switch (step.kind) {
    case "sequence": {
      return advanceSequence(cctx, cursor, deltaMs);
    }
    case "parallel": {
      return advanceParallel(cctx, cursor, deltaMs);
    }
    case "use": {
      return advanceUse(cctx, cursor, step.id, deltaMs);
    }
    case "wait": {
      return advanceWait(cursor, step.ms, deltaMs);
    }
    case "tween": {
      return advanceTween(cctx, cursor, step, deltaMs);
    }
    case "frames": {
      return advanceFrames(cctx, cursor, step, deltaMs);
    }
    case "mark": {
      reportMark(cctx, step.name);
      break;
    }
    case "set": {
      writeStep(cctx, step, { ...step.patch });
      break;
    }
    default: {
      cctx.rt.dispatch(step);
      break;
    }
  }

  cursor.ended = true;

  return deltaMs;
}

/**
 * Ends one step at its own end: a track writes its exact target, a step that never started writes
 * it at once, the marks are jumped in tree order and no effect is fired.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The cursor of the step.
 */
export function finishCursor(cctx: CursorCtx, cursor: Cursor): void {
  if (cursor.ended) return;

  const step = cursor.step;

  switch (step.kind) {
    case "sequence": {
      for (let index = cursor.index; index < cursor.children.length; index += 1) {
        const child = cursor.children[index];

        if (child !== undefined) finishCursor(cctx, child);
      }

      break;
    }
    case "parallel": {
      for (const child of cursor.children) finishCursor(cctx, child);

      break;
    }
    case "use": {
      const child = cursor.children[0];

      if (child !== undefined) finishCursor({ ...cctx, animation: step.id }, child);

      break;
    }
    case "mark": {
      reportMark(cctx, step.name);

      break;
    }
    case "tween": {
      if (cursor.started) cursor.motion?.finish();
      else writeStep(cctx, step, { ...step.to });

      break;
    }
    case "set": {
      writeStep(cctx, step, { ...step.patch });

      break;
    }
    case "frames": {
      finishFrames(cctx, step);

      break;
    }
    default: {
      break;
    }
  }

  cursor.ended = true;
}

/**
 * Writes the last key of a frames step, which is what a finished frame sprite shows.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The frames step.
 */
function finishFrames(cctx: CursorCtx, step: Extract<Step, { kind: "frames" }>): void {
  const key = step.keys.at(-1);
  const entity = key === undefined ? undefined : spriteOf(cctx.rt, step);

  if (entity !== undefined && key !== undefined) writeFrame(cctx.rt, entity, key);
}

/**
 * Ends one step where it stands: nothing is written, no mark is reported and no effect fires.
 * The steps after the current one of a sequence never start.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The cursor of the step.
 */
export function cancelCursor(cctx: CursorCtx, cursor: Cursor): void {
  if (cursor.ended) return;

  const step = cursor.step;

  switch (step.kind) {
    case "sequence": {
      const child = cursor.children[cursor.index];

      if (child !== undefined) cancelCursor(cctx, child);

      break;
    }
    case "parallel": {
      for (const child of cursor.children) cancelCursor(cctx, child);

      break;
    }
    case "use": {
      const child = cursor.children[0];

      if (child !== undefined) cancelCursor(cctx, child);

      break;
    }
    case "tween": {
      if (cursor.started) cursor.motion?.cancel();

      break;
    }
    default: {
      break;
    }
  }

  cursor.ended = true;
}

/**
 * Every entity a `tween`, `set` or `frames` step of the tree names, resolved once when the
 * timeline starts. They are the entities `Animation.playing` counts.
 *
 * @param rt - The timeline runtime.
 * @param step - The step tree.
 * @returns The entities, each once, in tree order.
 */
export function entitiesOf(rt: TimelineRuntime, step: Step): readonly Entity[] {
  const found = emptyEntitySet();

  collectEntities(rt, step, found);

  return [...found];
}

/**
 * Creates the empty entity set of one walk. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of entities.
 */
function emptyEntitySet(): Set<Entity> {
  return new Set();
}

/**
 * Walks the tree and collects the entities its writing steps name.
 *
 * @param rt - The timeline runtime.
 * @param step - The step to look into.
 * @param found - The set the entities are collected in.
 */
function collectEntities(rt: TimelineRuntime, step: Step, found: Set<Entity>): void {
  if (step.kind === "sequence" || step.kind === "parallel") {
    for (const child of step.steps) collectEntities(rt, child, found);

    return;
  }

  if (step.kind === "use") {
    collectEntities(rt, step.step, found);

    return;
  }

  if (step.kind !== "tween" && step.kind !== "set" && step.kind !== "frames") return;

  const entity = rt.entityOf(step.target);

  if (entity !== undefined) found.add(entity);
}
