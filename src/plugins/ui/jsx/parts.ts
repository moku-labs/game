/**
 * @file ui/jsx — a scene build in parts (spec 33, slice A): a root built aside is diffed by root
 * and by part under the frame's budget, laid out once, and applied in parts. The budget is
 * `world.projection.left()`, finite only while a build runs. The first building unit of a frame (a
 * root, a parked part, a part of an application) always runs, so a build always moves. A root held
 * warm (slice B+D) is built the same way, and one shown before its parts were done finishes in one
 * block. The reconcile owns the diff and the application of one element and lends them in.
 */
import type { Entity } from "../../world/types";
import { asError } from "../errors";
import type { UiCtx } from "../types";
import type { ApplyCursor, DescriptionNode, Element, Parked, Root } from "./types";

/**
 * How many elements a root built aside makes or applies in a frame between two reads of the
 * frame's budget, from the first read on (spec 33 A2, A6): the clock is read every 8 elements.
 */
const CLOCK_EVERY = 8;

/**
 * The most elements of roots built aside one frame applies. The components `applyFirst` adds are
 * flushed after the system, where the budget does not see them: the cap keeps that flush short
 * (spec 33 A6; 275 elements in one frame took 3.6 ms in Node, about 15 ms on the A26).
 */
const APPLY_CAP = 100;

/** What a parked part holds once it is back in the pool: no nodes and no element, so the pool keeps no tree alive. */
const NO_NODES: readonly DescriptionNode[] = [];

/**
 * What a build in parts borrows from the reconcile it belongs to: the diff of the children of one
 * element, the application of one element, and whether the range of a windowed scroll is moving.
 */
export type PartsReconcile = {
  /** Diffs the children of one element against the nodes of this render. */
  diffChildren(
    root: Root,
    parent: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): void;
  /** Applies the solved rect of one element: a live one moves, a new one spawns its components. */
  applyElement(element: Element, quiet: boolean): void;
  /** True while the range step diffs a windowed list. */
  isMoving(): boolean;
};

/**
 * Creates the set of the roots whose parts wait. Its own function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function rootSet(): Set<Root> {
  return new Set();
}

/**
 * Tells whether a root has parked parts.
 *
 * @param root - The root.
 * @returns True while children of its elements wait.
 */
function hasParked(root: Root): boolean {
  return (root.parked?.length ?? 0) > 0;
}

/**
 * Tells whether parts of a root built aside wait: children parked, or its application open.
 * Two field reads; false for every other root.
 *
 * @param root - The root, if it is still known.
 * @returns True while its build waits for a later frame.
 */
function waits(root: Root | undefined): boolean {
  return root !== undefined && (root.applying !== undefined || hasParked(root));
}

/**
 * Builds the parts half of the reconcile: the park queue of each root built aside and the pools of
 * its parts, the drain of the queue, the hold of a dirty root, and the application in parts.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param reconcile - The diff and the application the reconcile lends.
 * @returns The steps the reconcile calls.
 */
export function createParts(ctx: UiCtx, reconcile: PartsReconcile) {
  const state = ctx.state.jsx;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);

  // Since the start of the reconcile: the elements entered for roots built aside, whether the budget
  // was read spent, and whether a building unit ran. Since the start of the solve: the elements
  // applied in parts, and whether an application ended. The parked parts and the cursors are pooled:
  // a build allocates them once.
  let entered = 0;
  let spent = false;
  let unitRan = false;
  let applied = 0;
  let landed = false;
  const parkedPool: Parked[] = [];
  const cursorPool: ApplyCursor[] = [];
  // The roots whose parts wait, parked or in an open application. The drain and the application
  // step walk the roots only while one does: windows held warm and at rest cost one size read.
  const busy = rootSet();

  /**
   * Notes whether parts of a root wait now, after its queue or its application changed.
   *
   * @param root - The root.
   */
  function track(root: Root): void {
    if (waits(root)) busy.add(root);
    else busy.delete(root);
  }

  /**
   * Tells whether parts of any root wait: children parked, or an application open.
   *
   * @returns True while a build in parts has work left.
   */
  function working(): boolean {
    return busy.size > 0;
  }

  /**
   * Starts the frame's reconcile: no element entered, the budget not read, no building unit run.
   */
  function beginReconcile(): void {
    entered = 0;
    spent = false;
    unitRan = false;
  }

  /**
   * Starts the frame's solve: no element applied in parts, no application ended.
   */
  function beginSolve(): void {
    applied = 0;
    landed = false;
  }

  /**
   * Tells whether an application of a root built aside ended in this solve: its scrolls settle now.
   *
   * @returns True after the last part of an application.
   */
  function hasLanded(): boolean {
    return landed;
  }

  /**
   * Tells whether the frame's building budget is spent, read once every `CLOCK_EVERY` units of
   * work: a read of the clock costs more than a small unit.
   *
   * @param count - The units of work made in this frame so far.
   * @returns True when the count is a reading point and no budget is left.
   */
  function spentAt(count: number): boolean {
    return count > 0 && count % CLOCK_EVERY === 0 && ctx.deps.world.projection.left() <= 0;
  }

  /**
   * Counts an element entered for a root built aside and tells whether its children wait for a
   * later frame. From the 8th element of the frame the budget is read every 8; once it is spent,
   * the children of every next element wait. A row a range change scrolls in never parks: the
   * window moves in one block, as on a live root.
   *
   * @returns True when the children of the element wait.
   */
  function parks(): boolean {
    if (reconcile.isMoving()) return false;

    entered += 1;
    if (!spent) spent = spentAt(entered);

    return spent;
  }

  /**
   * Leaves the children of a new element of a root built aside for a later frame: the element
   * itself exists, so the child list of its parent is complete. The part is queued behind the
   * root's other parts, with the cause of the diff running now.
   *
   * @param root - The root built aside.
   * @param element - The element that entered.
   * @param nodes - The children it would have diffed.
   * @param instance - The identity of the nearest component instance.
   */
  function park(
    root: Root,
    element: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): void {
    const cause = state.building;
    const part = parkedPool.pop() ?? { element, nodes, instance, cause };

    part.element = element;
    part.nodes = nodes;
    part.instance = instance;
    part.cause = cause;
    root.parked ??= [];
    root.parked.push(part);
    track(root);
  }

  /**
   * Puts a parked part back in the pool, its element and nodes dropped.
   *
   * @param part - A part that was diffed or forgotten.
   */
  function recycle(part: Parked): void {
    part.element = undefined;
    part.nodes = NO_NODES;
    parkedPool.push(part);
  }

  /**
   * Tells whether the next building unit may run in this frame: the first one always does, so a
   * build always moves; a later one while the budget lasts.
   *
   * @returns True when the unit runs.
   */
  function mayRun(): boolean {
    return !unitRan || ctx.deps.world.projection.left() > 0;
  }

  /**
   * Diffs one parked part under the cause it was parked with. A part whose element left meanwhile
   * is dropped. A part that throws fails its root alone, as the root's own diff does.
   *
   * @param root - The root built aside.
   * @param part - The part.
   */
  function diffPart(root: Root, part: Parked): void {
    const element = part.element;

    if (element === undefined || lookup(element.entity) !== element) return;

    const cause = state.building;

    unitRan = true;
    state.building = part.cause;

    try {
      reconcile.diffChildren(root, element, part.nodes, part.instance);
    } catch (error) {
      ctx.log.error("ui:root-failed", { root: root.name }, asError(error));
    } finally {
      state.building = cause;
    }

    root.needsSolve = true;
  }

  /**
   * Diffs the parked parts of the roots built aside, each root's in the order they were parked,
   * while the frame's budget lasts (spec 33 A3). Children that park again go to the end of their
   * root's queue.
   */
  function drainParked(): void {
    // Per frame: one number while no part waits, also with windows held warm and at rest.
    if (busy.size === 0) return;

    for (const root of state.roots.values()) {
      const parked = root.parked;

      while (parked !== undefined && parked.length > 0) {
        if (!mayRun()) return;

        const part = parked.shift();

        if (part === undefined) break;

        diffPart(root, part);
        recycle(part);
      }

      track(root);
    }
  }

  /**
   * Holds a dirty root built aside for a later frame instead of diffing it now: while parked parts
   * of it wait, so no element is made twice, and once the frame's budget is spent after its first
   * building unit. It stays dirty: the next frame lists it again and diffs its newest tree once
   * (spec 33 A1, A4). The drain runs before, until its queue is empty or the budget is spent, so a
   * root with parked parts meets a spent budget here too. A live root is never held.
   *
   * @param root - A root with work this frame.
   * @returns True when the root waits.
   */
  function holdRoot(root: Root): boolean {
    if (!ctx.deps.world.projection.isBuilding(root.entity)) return false;

    if (hasParked(root) || !mayRun()) {
      root.dirty = true;

      return true;
    }

    unitRan = true;

    return false;
  }

  /**
   * Forgets the parked parts and the open application of a root whose build ends here: a drop, a
   * discard, its exit or a restore.
   *
   * @param root - The root.
   */
  function forgetParts(root: Root): void {
    const parked = root.parked;

    while (parked !== undefined && parked.length > 0) {
      const part = parked.pop();

      if (part !== undefined) recycle(part);
    }

    dropApplication(root);
    track(root);
  }

  /**
   * Drops the open application of a root, if it has one, with no element applied: its cursor goes
   * back to the pool, empty.
   *
   * @param root - The root.
   */
  function dropApplication(root: Root): void {
    const cursor = root.applying;

    if (cursor === undefined) return;

    // Emptied by `pop`: a cut by `length` would free its store.
    while (cursor.stack.length > 0) cursor.stack.pop();

    delete root.applying;
    cursorPool.push(cursor);
  }

  /**
   * Finishes the build of a root shown before its parts were done (a warm window opened while it
   * was built, spec 33 B+D): every parked part is diffed now, whatever the budget, and its children
   * no longer park, since the root is not built aside any more; an open application is dropped.
   * The root then asks for a solve, which lays it out and applies it whole, so no half-built frame
   * is drawn.
   *
   * @param root - A root that was built aside and is not any more.
   * @returns True when parts were left, so the solve of this frame applies the root in one block.
   */
  function finish(root: Root): boolean {
    if (!waits(root)) return false;

    const parked = root.parked;

    while (parked !== undefined && parked.length > 0) {
      const part = parked.shift();

      if (part === undefined) break;

      diffPart(root, part);
      recycle(part);
    }

    dropApplication(root);
    track(root);
    root.needsSolve = true;

    return true;
  }

  /**
   * Opens the application of a solved root built aside and applies its first part (spec 33 A6).
   *
   * @param root - The root built aside.
   * @param element - Its root element.
   * @param quiet - Whether its live elements take their rects with no motion.
   */
  function applyInParts(root: Root, element: Element, quiet: boolean): void {
    const cursor = cursorPool.pop() ?? { stack: [], quiet };

    cursor.quiet = quiet;
    cursor.stack.push(element);
    root.applying = cursor;
    applyPart(root, cursor);
    track(root);
  }

  /**
   * Applies the next elements of an open application, top-down, parent before children in the
   * order of `applyRects`, until the frame's budget is spent (read every 8 elements of the frame)
   * or the frame applied `APPLY_CAP` elements of roots built aside. An element that left on the
   * way is skipped. The last element closes the application.
   *
   * @param root - The root built aside.
   * @param cursor - Its open application.
   */
  function applyPart(root: Root, cursor: ApplyCursor): void {
    const stack = cursor.stack;

    while (stack.length > 0 && applied < APPLY_CAP) {
      if (spentAt(applied)) return;

      const element = stack.pop();

      if (element === undefined || lookup(element.entity) !== element) continue;

      reconcile.applyElement(element, cursor.quiet);
      applied += 1;
      stackChildren(stack, element);
    }

    if (stack.length === 0) closeApplication(root, cursor);
  }

  /**
   * Puts the children of an applied element on the stack of its application, the first one on top,
   * so they come next, in the order of `applyRects`.
   *
   * @param stack - The elements still to apply.
   * @param element - The element just applied.
   */
  function stackChildren(stack: Element[], element: Element): void {
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children[index];
      const childElement = child === undefined ? undefined : lookup(child);

      if (childElement !== undefined) stack.push(childElement);
    }
  }

  /**
   * Ends the application of a root built aside: its scrolls settle in this solve, and its live
   * hosts take their views in it, now that the root is whole (spec 33 A7).
   *
   * @param root - The root built aside.
   * @param cursor - Its application, empty.
   */
  function closeApplication(root: Root, cursor: ApplyCursor): void {
    delete root.applying;
    cursorPool.push(cursor);
    track(root);
    landed = true;

    for (const host of state.hosts) {
      if (lookup(host)?.root === root.entity) state.risen.add(host);
    }
  }

  /**
   * Applies the next part of every open application of a root built aside, in mount order, while
   * the frame's budget lasts. It runs before any root is solved: a root whose application ends
   * here is solved again in the same call when it asks for it.
   */
  function applyParts(): void {
    // Per frame: one number while no part waits, also with windows held warm and at rest.
    if (busy.size === 0) return;

    for (const root of state.roots.values()) {
      const cursor = root.applying;

      if (cursor === undefined) continue;
      if (!mayRun()) return;

      unitRan = true;
      applyPart(root, cursor);
    }
  }

  return {
    beginReconcile,
    beginSolve,
    hasLanded,
    parks,
    park,
    waits,
    working,
    drainParked,
    holdRoot,
    forgetParts,
    finish,
    applyInParts,
    applyParts
  };
}
