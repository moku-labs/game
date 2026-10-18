/**
 * @file anim/timeline — the cursor over a step tree: one mutable record per step, the advance
 * that carries the remainder of a finished step into the next one of the same frame, and the two
 * ways out. It reaches the world only through the injected runtime. A `{ projection, key }`
 * target names the entity that held the key when the timeline started, for every step.
 */
import { Sprite } from "../../renderer/components";
import type { Entity } from "../../world/types";
import { asComponent } from "../components";
import type { StepMotion } from "../tween/types";
import type { Target } from "../types";
import { frameIndexAt, framesDurationMs, writeFrame } from "./frames";
import { spawnStep } from "./spawn";
import type { Cursor, CursorCtx, Step, TimelineRuntime } from "./types";

/** A `frames` cursor starts before its first key, so the first advance always writes one. */
export const BEFORE_FIRST_FRAME = -1;

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
    clock: new Float64Array(1),
    motion: undefined,
    started: false,
    ended: false,
    held: undefined
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
 * Tells whether a target is a `{ projection, key }` target, the one kind the timeline resolves when
 * it starts.
 *
 * @param target - The target a step names.
 * @returns True for a projection key.
 * @example
 * ```ts
 * isKeyTarget({ projection: "board.items", key: "i7" }); // true
 * ```
 */
function isKeyTarget(target: Target): boolean {
  return typeof target !== "number" && !("spawned" in target);
}

/**
 * The entity a target names for a step that starts now. A key target the timeline resolved when it
 * started is that entity, never looked up again, also when it left its projection or is gone. Any
 * other target is looked up now: a key nothing held at the start, an entity, a spawned id, which
 * only the spawn table of this timeline answers.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param target - The target the step names.
 * @returns The entity, or `undefined`.
 */
function entityFor(cctx: CursorCtx, target: Target): Entity | undefined {
  // A frames step asks every frame: the table is keyed by the target object, so no key is built.
  return cctx.targets.get(target) ?? cctx.rt.entityOf(target, cctx.spawned);
}

/**
 * Resolves the target of a step to a live entity that carries the component.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - A step that names a target and a component.
 * @returns The entity, or `undefined` when the step has nothing to write.
 */
function targetOf(
  cctx: CursorCtx,
  step: Extract<Step, { kind: "tween" | "set" }>
): Entity | undefined {
  const entity = entityFor(cctx, step.target);

  if (entity === undefined || cctx.rt.read(entity, step.component) === undefined) return undefined;

  return entity;
}

/**
 * Resolves the target of a `frames` step to a live entity that carries a `Sprite`.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The frames step.
 * @returns The entity, or `undefined`.
 */
function spriteOf(cctx: CursorCtx, step: Extract<Step, { kind: "frames" }>): Entity | undefined {
  const entity = entityFor(cctx, step.target);

  if (entity === undefined || cctx.rt.read(entity, asComponent(Sprite)) === undefined) {
    return undefined;
  }

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
  const entity = targetOf(cctx, step);

  if (entity === undefined) return undefined;

  return cctx.rt.start(entity, step.component, tweenTargetOf(cctx, entity, step), {
    ms: step.ms,
    ease: step.ease,
    delayMs: step.delayMs,
    additive: step.additive,
    reduced: step.reduced
  });
}

/**
 * The target fields of a `tween` step for one entity: as written in the local space, turned into
 * the space of the entity's parent in the root space.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param entity - The entity the step moves.
 * @param step - The tween step.
 * @returns The fields the track or the write aims at.
 */
function tweenTargetOf(
  cctx: CursorCtx,
  entity: Entity,
  step: Extract<Step, { kind: "tween" }>
): Record<string, number> {
  if (step.space === "root") return cctx.rt.toLocal(entity, step.component, step.to);

  return { ...step.to };
}

/**
 * Writes the target of a `tween` step that never started, in the space the step names.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The tween step.
 */
function writeTween(cctx: CursorCtx, step: Extract<Step, { kind: "tween" }>): void {
  const entity = targetOf(cctx, step);

  if (entity !== undefined)
    cctx.rt.write(entity, step.component, tweenTargetOf(cctx, entity, step));
}

/**
 * Writes the patch of a `set` step.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param step - The set step.
 */
function writeSet(cctx: CursorCtx, step: Extract<Step, { kind: "set" }>): void {
  const entity = targetOf(cctx, step);

  if (entity !== undefined) cctx.rt.write(entity, step.component, { ...step.patch });
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

  const outer = cctx.animation;

  // per frame: the one context carries the nested id down and gets the outer one back, no copy.
  cctx.animation = id;
  const rest = advanceCursor(cctx, child, deltaMs);
  cctx.animation = outer;

  if (!child.ended) return 0;

  cursor.ended = true;

  return rest;
}

/**
 * Advances a `wait`. It reads the length off the step itself: a length that is not a small whole
 * number would be boxed anew at every call that hands it over.
 *
 * @param cursor - The wait cursor.
 * @param step - The wait step.
 * @param deltaMs - Milliseconds of game time to consume.
 * @returns The milliseconds left over past the end of the wait.
 */
function advanceWait(
  cursor: Cursor,
  step: Extract<Step, { kind: "wait" }>,
  deltaMs: number
): number {
  tick(cursor, deltaMs);

  const durationMs = step.ms;
  const elapsed = cursor.clock[0] ?? 0;

  if (elapsed < durationMs) return 0;

  cursor.ended = true;

  return elapsed - durationMs;
}

/**
 * Moves the clock of a `wait` or a `frames` cursor on by one delta.
 *
 * @param cursor - The cursor.
 * @param deltaMs - Milliseconds of game time to consume.
 */
function tick(cursor: Cursor, deltaMs: number): void {
  // per frame: the clock is a cell, written in place; the caller reads it back, so no number
  // leaves this call boxed.
  cursor.clock[0] = (cursor.clock[0] ?? 0) + deltaMs;
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
 * Claims the sprite a `frames` step writes, once per entity it resolves, so the `Frames` loop of
 * that entity stands aside while the step runs.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The frames cursor.
 * @param entity - The entity the step writes now.
 */
function holdSprite(cctx: CursorCtx, cursor: Cursor, entity: Entity): void {
  if (cursor.held === entity) return;

  releaseSprite(cctx, cursor);
  cursor.held = entity;
  cctx.rt.holdFrames(entity);
}

/**
 * Hands the sprite a `frames` step held back to its `Frames` loop. Every way the step ends calls
 * it; only the first call releases.
 *
 * @param cctx - What the cursor carries down the tree.
 * @param cursor - The frames cursor.
 */
function releaseSprite(cctx: CursorCtx, cursor: Cursor): void {
  if (cursor.held === undefined) return;

  cctx.rt.releaseFrames(cursor.held);
  cursor.held = undefined;
}

/**
 * Advances a `frames` step: it writes the key the elapsed time landed on, and ends after the last
 * one unless the list loops. While it runs it holds its entity against the `Frames` loop.
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
  const entity = step.keys.length === 0 ? undefined : spriteOf(cctx, step);

  if (entity === undefined) {
    releaseSprite(cctx, cursor);
    cursor.ended = true;

    return deltaMs;
  }

  holdSprite(cctx, cursor, entity);

  tick(cursor, deltaMs);

  const elapsed = cursor.clock[0] ?? 0;
  const index = frameIndexAt(step.keys, step.fps, step.loop, elapsed);
  const key = step.keys[index];

  if (index !== cursor.index && key !== undefined) {
    cursor.index = index;
    writeFrame(cctx.rt, entity, key);
  }

  const total = framesDurationMs(step.keys, step.fps);

  if (step.loop || elapsed < total) return 0;

  releaseSprite(cctx, cursor);
  cursor.ended = true;

  return elapsed - total;
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
      return advanceWait(cursor, step, deltaMs);
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
      writeSet(cctx, step);
      break;
    }
    case "spawn": {
      spawnStep(cctx, step);
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
 * it at once, the marks are jumped in tree order, no effect is fired and nothing is spawned: the
 * timeline despawns its entities as it ends, so a skipped spawn would only flash.
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

      if (child === undefined) break;

      const outer = cctx.animation;

      cctx.animation = step.id;
      finishCursor(cctx, child);
      cctx.animation = outer;

      break;
    }
    case "mark": {
      reportMark(cctx, step.name);

      break;
    }
    case "tween": {
      if (cursor.started) cursor.motion?.finish();
      else writeTween(cctx, step);

      break;
    }
    case "set": {
      writeSet(cctx, step);

      break;
    }
    case "frames": {
      finishFrames(cctx, step);
      releaseSprite(cctx, cursor);

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
  const entity = key === undefined ? undefined : spriteOf(cctx, step);

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
    case "frames": {
      releaseSprite(cctx, cursor);

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
 * timeline starts: the entities `Animation.playing` counts, and the entity of every
 * `{ projection, key }` target, which every later step of the timeline writes.
 *
 * @param rt - The timeline runtime.
 * @param step - The step tree.
 * @returns The entity of each key target by the target object, and the entities, each once, in
 *   tree order.
 */
export function resolveTargets(
  rt: TimelineRuntime,
  step: Step
): { targets: Map<Target, Entity>; entities: readonly Entity[] } {
  const found = emptyEntitySet();
  const targets = emptyTargetTable();

  collectEntities(rt, step, found, targets);

  return { targets, entities: [...found] };
}

/**
 * Creates the empty target table of one walk. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map from key target to entity.
 */
function emptyTargetTable(): Map<Target, Entity> {
  return new Map();
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
 * Walks the tree and collects the entities its writing steps name, and the entity of every key
 * target under the target object. Each step keeps its target object for the whole play, so the
 * object is the key and no key string is ever built.
 *
 * @param rt - The timeline runtime.
 * @param step - The step to look into.
 * @param found - The set the entities are collected in.
 * @param targets - The table the key targets are recorded in.
 */
function collectEntities(
  rt: TimelineRuntime,
  step: Step,
  found: Set<Entity>,
  targets: Map<Target, Entity>
): void {
  if (step.kind === "sequence" || step.kind === "parallel") {
    for (const child of step.steps) collectEntities(rt, child, found, targets);

    return;
  }

  if (step.kind === "use") {
    collectEntities(rt, step.step, found, targets);

    return;
  }

  if (step.kind !== "tween" && step.kind !== "set" && step.kind !== "frames") return;

  const entity = rt.entityOf(step.target);

  if (entity === undefined) return;

  found.add(entity);
  if (isKeyTarget(step.target)) targets.set(step.target, entity);
}
