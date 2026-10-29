/**
 * @file renderer/sync — the hit test. Pure component math: Pixi updates its world matrices at
 * render time, one frame after the input phase asks. One walk yields every hit, topmost first:
 * `hitTest` stops at the first one the caller accepts, `hitAll` lists them all. It runs on every
 * pointer move (F118), so the walk allocates nothing: no sorted copy of a container's children, no
 * list of the tree, no generator, no pose object. Its scratch is a pooled walk, so a caller's
 * accept function that asks again gets a walk of its own.
 */
import type { Entity } from "../../world/types";
import { NineSlice, Shape, type TransformValue } from "../components";
import type { PixiContainer, Point } from "../types";
import { parentOf, rootPoseInto } from "./pose";
import type { HitBox, SyncCtx } from "./types";

/** How deep a parent chain or a container tree is followed. */
const MAX_DEPTH = 32;

/** Below this effective alpha a view is treated as not there. */
const MIN_ALPHA = 0.01;

/** The scratch of one hit test, taken from `idleWalks` and given back when it ends. */
type Walk = {
  /** Per depth, the child indices of an out-of-order container, sorted by `zIndex`; only ever grown. */
  orders: number[][];
  /**
   * Per depth, the alpha the objects at that depth draw with, their own included. Kept here, not passed: a double
   * handed to a call that is not inlined is boxed, once per view.
   */
  alphas: Float64Array;
  /** The root pose of the entity whose box is tested, written in place. */
  pose: TransformValue;
  /** The reference point brought into an entity's own space, written in place. */
  local: Point;
  /** The reference point. */
  x: number;
  y: number;
  /** The filter of `hitTest`; `undefined` while `hitAll` collects. */
  accept: ((entity: Entity) => boolean) | undefined;
  /** Where `hitAll` collects; `undefined` while `hitTest` looks for one. */
  out: Entity[] | undefined;
  /** The entity `hitTest` accepted. */
  found: Entity | undefined;
};

/** Walks no hit test holds now: one, unless an accept function asked again. */
const idleWalks: Walk[] = [];

/**
 * Takes a walk from the pool, or makes one the first time and whenever every walk is held.
 *
 * @returns The walk.
 */
function takeWalk(): Walk {
  return (
    idleWalks.pop() ?? {
      orders: [],
      alphas: new Float64Array(MAX_DEPTH + 1),
      pose: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
      local: { x: 0, y: 0 },
      x: 0,
      y: 0,
      accept: undefined,
      out: undefined,
      found: undefined
    }
  );
}

/**
 * Gives a walk back, holding nothing of the caller.
 *
 * @param walk - The walk.
 */
function releaseWalk(walk: Walk): void {
  walk.accept = undefined;
  walk.out = undefined;
  walk.found = undefined;
  idleWalks.push(walk);
}

/**
 * Brings the reference point of a walk into the local space of an entity: its root pose undone,
 * the pivot added back. The numbers of `localPoseOf` with the point posed as a child of the entity,
 * written into the walk's own point.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk, its point and its scratch.
 * @param entity - The entity whose box is tested.
 * @returns The walk's local point.
 */
function localPoint(sctx: SyncCtx, walk: Walk, entity: Entity): Point {
  const local = walk.local;

  if (entity === 0) {
    local.x = walk.x;
    local.y = walk.y;

    return local;
  }

  const above = rootPoseInto(sctx.ctx.deps.world.ecs, entity, walk.pose);
  const scale = above.scale === 0 ? 1 : above.scale;
  const cos = Math.cos(-above.rotation);
  const sin = Math.sin(-above.rotation);
  const dx = walk.x - above.x;
  const dy = walk.y - above.y;

  local.x = above.pivot.x + (dx * cos - dy * sin) / scale;
  local.y = above.pivot.y + (dx * sin + dy * cos) / scale;

  return local;
}

/**
 * Tells whether a local point is inside a rectangle of a given size at the origin. A rectangle
 * without area holds no point.
 *
 * @param width - The width.
 * @param height - The height.
 * @param point - The point, in local units.
 * @returns True when the rectangle holds the point.
 * @example
 * ```ts
 * inSize(100, 100, { x: 100, y: 0 }); // true
 * ```
 */
function inSize(width: number, height: number, point: Point): boolean {
  return (
    width > 0 && height > 0 && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
  );
}

/**
 * Tells whether a local point is inside a hit box. A box without area holds no point: a particle
 * container measures 0 x 0 and is never hit, not even at its origin.
 *
 * @param box - The box, in local units.
 * @param point - The point, in local units.
 * @returns True when the box holds the point.
 * @example
 * ```ts
 * inBox({ x: -32, y: -32, width: 64, height: 64 }, { x: 0, y: 0 }); // true
 * ```
 */
function inBox(box: HitBox, point: Point): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/**
 * Tells whether an entity clips its children and the walk's point falls outside the rectangle it
 * shows: the box of a `Shape` or a `NineSlice` with `clip: true`.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk.
 * @param entity - The entity.
 * @returns True when it clips the point away.
 */
function clipsAway(sctx: SyncCtx, walk: Walk, entity: Entity): boolean {
  const ecs = sctx.ctx.deps.world.ecs;
  const shape = ecs.get(entity, Shape);

  if (shape?.clip === true) return !inSize(shape.w, shape.h, localPoint(sctx, walk, entity));

  const nine = ecs.get(entity, NineSlice);

  if (nine?.clip === true) return !inSize(nine.width, nine.height, localPoint(sctx, walk, entity));

  return false;
}

/**
 * Tells whether a clipping ancestor hides the walk's point: a `Shape` or a `NineSlice` with
 * `clip: true` shows its children only inside its own rectangle, so a point outside it reaches
 * nothing below.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk.
 * @param entity - The entity being tested.
 * @returns True when the point falls outside a clipping ancestor.
 */
function clippedOut(sctx: SyncCtx, walk: Walk, entity: Entity): boolean {
  const ecs = sctx.ctx.deps.world.ecs;
  let current = parentOf(ecs, entity);

  for (let depth = 0; depth < MAX_DEPTH && current !== 0; depth += 1) {
    if (clipsAway(sctx, walk, current)) return true;

    current = parentOf(ecs, current);
  }

  return false;
}

/**
 * The alpha a display object really draws with, and 0 when anything on its way to the root is
 * hidden, is a HUD part an overlay fades (spec 22 O7.5), or when it hangs in no tree at all.
 *
 * @param object - The display object.
 * @param root - The root container of `sync`.
 * @param off - Top objects that take no tap: HUD parts leaving or not fully back.
 * @returns The effective alpha.
 */
function effectiveAlpha(
  object: PixiContainer,
  root: PixiContainer,
  off: ReadonlySet<PixiContainer> | undefined
): number {
  let alpha = 1;
  let current: PixiContainer | undefined = object;

  for (let depth = 0; depth < MAX_DEPTH && current !== undefined; depth += 1) {
    if (current === root) return alpha;
    if (!current.visible || off?.has(current) === true) return 0;

    alpha *= current.alpha;
    current = current.parent ?? undefined;
  }

  return 0;
}

/**
 * Tells whether the player can see a display object: it hangs under the root of `sync`, nothing
 * on its way there is hidden, and the alpha it draws with is above 0.01.
 *
 * @param object - The display object.
 * @param root - The root container of `sync`.
 * @param off - Top objects that count as not there, for the hit test: the HUD parts an overlay fades.
 * @returns True when the object is drawn.
 */
export function isShown(
  object: PixiContainer,
  root: PixiContainer,
  off?: ReadonlySet<PixiContainer>
): boolean {
  return effectiveAlpha(object, root, off) > MIN_ALPHA;
}

/**
 * How many objects a container is from the root of `sync`, counted as `effectiveAlpha` counts its
 * steps: itself and every ancestor below the root.
 *
 * @param container - The container.
 * @param root - The root container of `sync`.
 * @returns The count, or `MAX_DEPTH` when the root is not reached within it.
 */
function stepsToRoot(container: PixiContainer, root: PixiContainer): number {
  let current: PixiContainer | undefined = container;

  for (let steps = 0; steps < MAX_DEPTH && current !== undefined; steps += 1) {
    if (current === root) return steps;

    current = current.parent ?? undefined;
  }

  return MAX_DEPTH;
}

/**
 * Tells whether children stand in `zIndex` order. A depth is read straight off the child and compared at once: a
 * fractional `zIndex` held in a variable that may also be a fallback number is boxed, once per child.
 *
 * @param children - The children.
 * @returns True when no child has a lower `zIndex` than the one before it.
 */
function inZOrder(children: readonly PixiContainer[]): boolean {
  for (let index = 1; index < children.length; index += 1) {
    const before = children[index - 1];
    const child = children[index];

    if (before !== undefined && child !== undefined && before.zIndex > child.zIndex) return false;
  }

  return true;
}

/**
 * The child indices of a container in `zIndex` order, insertion order kept between equals, as a
 * stable sort gives them; `undefined` when the children already stand so, as Pixi leaves a
 * sortable container after each render. Written into the walk's list for that depth.
 *
 * @param walk - The walk.
 * @param children - The children.
 * @param depth - The depth of the walk, which owns one list.
 * @returns The sorted indices, or `undefined` for the children's own order.
 */
function orderOf(
  walk: Walk,
  children: readonly PixiContainer[],
  depth: number
): number[] | undefined {
  if (inZOrder(children)) return undefined;

  let order = walk.orders[depth];

  if (order === undefined) {
    order = [];
    walk.orders[depth] = order;
  }

  // Insertion sort into the kept list: stable, and short work on a list a render left nearly sorted.
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    if (child === undefined) continue;

    let slot = index;

    for (; slot > 0; slot -= 1) {
      const before = order[slot - 1];
      const other = before === undefined ? undefined : children[before];

      if (before === undefined || other === undefined || other.zIndex <= child.zIndex) break;

      order[slot] = before;
    }

    order[slot] = index;
  }

  return order;
}

/**
 * Tests one display object of the walk: its view, whether the player sees it, whether its hit box
 * holds the point, whether a clipping ancestor hides the point. A hit is accepted or collected.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk.
 * @param object - The display object.
 * @param depth - Its depth in the walk, whose alpha it draws with.
 * @returns True when `hitTest` accepted it and the walk ends.
 */
function testObject(sctx: SyncCtx, walk: Walk, object: PixiContainer, depth: number): boolean {
  if ((walk.alphas[depth] ?? 0) <= MIN_ALPHA) return false;

  const state = sctx.ctx.state.sync;
  const entity = state.entityOf.get(object);
  const view = entity === undefined ? undefined : state.views.get(entity);

  if (entity === undefined || view === undefined) return false;
  if (!inBox(view.hitBox, localPoint(sctx, walk, entity))) return false;
  if (clippedOut(sctx, walk, entity)) return false;

  if (walk.out !== undefined) {
    walk.out.push(entity);

    return false;
  }

  if (walk.accept?.(entity) !== true) return false;

  walk.found = entity;

  return true;
}

/**
 * Walks the children of a container in draw order from the top: by `zIndex` descending, then by
 * insertion descending. The children of a wrapper come before the wrapper's own visual. A hidden
 * object or a HUD part an overlay fades takes its whole subtree out; the alpha is carried down.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk.
 * @param container - The container to walk.
 * @param depth - How deep the walk already is.
 * @param steps - How many objects the container is from the root.
 * @returns True when `hitTest` accepted a hit and the walk ends. The container's alpha is the walk's at `depth`.
 */
function walkChildren(
  sctx: SyncCtx,
  walk: Walk,
  container: PixiContainer,
  depth: number,
  steps: number
): boolean {
  // An object farther than `MAX_DEPTH` steps from the root never reaches it in `effectiveAlpha`.
  if (depth >= MAX_DEPTH || steps + 1 >= MAX_DEPTH) return false;

  const off = sctx.ctx.state.sync.overlay.offTops;
  const children = container.children;
  const order = orderOf(walk, children, depth);
  const alphas = walk.alphas;
  const alpha = alphas[depth] ?? 0;

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[order === undefined ? index : (order[index] ?? index)];

    if (child === undefined || !child.visible || off.has(child)) continue;

    const shown = alpha * child.alpha;

    if (shown === 0) continue;

    // The subtree's walk writes only the depths below this one.
    alphas[depth + 1] = shown;
    if (child.children.length > 0 && walkChildren(sctx, walk, child, depth + 1, steps + 1)) {
      return true;
    }
    if (testObject(sctx, walk, child, depth + 1)) return true;
  }

  return false;
}

/**
 * Walks every view under the walk's point, topmost first: the layers from the last one of the
 * scene's list, inside a layer by draw order from the top. Nothing while inert or before the scene
 * declared its layers. A layer that hangs under no root, or that is hidden, holds no hit.
 *
 * @param sctx - Domain context of the sync module.
 * @param walk - The walk.
 * @returns True when `hitTest` accepted a hit.
 */
function walkLayers(sctx: SyncCtx, walk: Walk): boolean {
  const state = sctx.ctx.state.sync;
  const root = state.root;
  const list = state.layerList;

  if (root === undefined || list === undefined) return false;

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const name = list[index]?.name;
    const container = name === undefined ? undefined : state.layers.get(name)?.container;

    if (container === undefined) continue;

    const alpha = effectiveAlpha(container, root, state.overlay.offTops);
    const steps = stepsToRoot(container, root);

    if (alpha === 0 || steps >= MAX_DEPTH) continue;

    walk.alphas[0] = alpha;
    if (walkChildren(sctx, walk, container, 0, steps)) return true;
  }

  return false;
}

/**
 * The topmost entity under a reference point that the caller accepts. The walk stops there.
 *
 * @param sctx - Domain context of the sync module.
 * @param x - Reference x.
 * @param y - Reference y.
 * @param accept - The filter of the caller.
 * @returns The entity, or `undefined`.
 */
export function hitTest(
  sctx: SyncCtx,
  x: number,
  y: number,
  accept: (entity: Entity) => boolean
): Entity | undefined {
  const walk = takeWalk();

  walk.x = x;
  walk.y = y;
  walk.accept = accept;

  try {
    return walkLayers(sctx, walk) ? walk.found : undefined;
  } finally {
    releaseWalk(walk);
  }
}

/**
 * Every entity under a reference point, topmost first.
 *
 * @param sctx - Domain context of the sync module.
 * @param x - Reference x.
 * @param y - Reference y.
 * @returns The entities, a fresh array; empty when nothing is there.
 */
export function hitAll(sctx: SyncCtx, x: number, y: number): Entity[] {
  const walk = takeWalk();
  const out: Entity[] = [];

  walk.x = x;
  walk.y = y;
  walk.out = out;

  try {
    walkLayers(sctx, walk);

    return out;
  } finally {
    releaseWalk(walk);
  }
}
