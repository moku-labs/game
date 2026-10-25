/**
 * @file renderer/sync — the pre-draw of a scene build (spec 31, F61 S2): once every building view is made, the held
 * tops are drawn into a 4 x 4 target of the module's own, in pieces of subtrees of at most `PREDRAW_NODES` nodes, so
 * Pixi builds their geometry, text and uploads in the build frames instead of in the swap frame. A piece is a subtree
 * cut by its node count, not by its level: one big child of a top would be one long call. Pixi makes a rendered
 * container a render group; the pre-draw takes away the groups it made, so the tree keeps the structure it is drawn
 * with live. A piece is drawn only while it still hangs in the top it was cut from: a top that changed since is cut
 * again. A piece that throws ends the pre-draw of the build, the swap then draws as without it. A subtree that carries a
 * filter or a mask is never a piece, nor in one: drawn alone it would cost a filter pass per piece and open Pixi's
 * filter or mask stack in a render of its own, which the warm-up never does either (a throw there leaves the stack
 * unbalanced). It is drawn first at the swap, as without the pre-draw. Its filter-free neighbours are still pieces. The
 * pre-draw's renders are no passes of the frame: the monitor's counters are paused around them.
 */
import type { PixiContainer, PixiFilter, PixiRenderTexture } from "../types";
import type { SyncCtx } from "./types";

/** The most nodes a piece of the pre-draw holds: about 4 ms of a first draw on the A26 (spike p21). */
export const PREDRAW_NODES = 60;

/** The side of the pre-draw target, in CSS pixels: the smallest that still draws a triangle. */
const TARGET_SIZE = 4;

/**
 * Tells whether the pre-draw of the running build has nothing more to draw: it ended by an error, it is skipped (the
 * warm-up failed on this device, no device draws), or every held top was drawn.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when the pre-draw holds the swap back no longer.
 */
export function predrawDone(sctx: SyncCtx): boolean {
  const { predraw, heldViews, warm } = sctx.ctx.state.sync;

  if (predraw.failed || warm.failed || !sctx.deps.host.ready()) return true;

  return predraw.head >= predraw.count && predraw.next >= heldViews.count;
}

/**
 * Tells whether a node draws through an effect of its own: filters, or a mask over it.
 *
 * @param node - The node.
 * @returns True when it holds a filter or a mask.
 */
function carriesEffect(node: PixiContainer): boolean {
  const filters: readonly PixiFilter[] | null | undefined = node.filters;
  // Pixi answers `undefined` for a node that never had a mask, `null` for one whose mask was cleared.
  const mask: PixiContainer["mask"] | undefined = node.mask;

  return (
    (filters !== null && filters !== undefined && filters.length > 0) ||
    (mask !== null && mask !== undefined)
  );
}

/**
 * Tells whether a node is the mask of one of its siblings, as `sync` hangs a clip's mask beside the container it
 * clips.
 *
 * @param siblings - The children of its parent.
 * @param node - The node.
 * @returns True when a sibling is masked by it.
 */
function masksSibling(siblings: readonly PixiContainer[], node: PixiContainer): boolean {
  for (const sibling of siblings) if (sibling.mask === node) return true;

  return false;
}

/**
 * The nodes of a subtree, counted until they pass a limit. A node that carries an effect counts past the limit at
 * once, so a subtree that holds one is cut further and never drawn whole.
 *
 * @param node - The root of the subtree.
 * @param limit - The count past which the walk stops.
 * @returns The node count, or a number above `limit`.
 */
function nodesIn(node: PixiContainer, limit: number): number {
  if (carriesEffect(node)) return limit + 1;

  const children = node.children;
  let count = 1;

  for (let index = 0; index < children.length && count <= limit; index += 1) {
    const child = children[index];

    if (child !== undefined) count += nodesIn(child, limit - count);
  }

  return count;
}

/**
 * Cuts a subtree into pieces of at most `PREDRAW_NODES` nodes, in drawing order: a subtree that fits and carries no
 * effect is one piece, a larger one or one that holds an effect is cut at its children. A node that carries a filter or
 * a mask is left out with its whole subtree, and so is a clip's mask beside the container it clips. A leaf without an
 * effect is always one piece.
 *
 * @param sctx - Domain context of the sync module.
 * @param node - The root of the subtree.
 */
function cut(sctx: SyncCtx, node: PixiContainer): void {
  if (carriesEffect(node)) return;

  const predraw = sctx.ctx.state.sync.predraw;
  const children = node.children;

  if (children.length === 0 || nodesIn(node, PREDRAW_NODES) <= PREDRAW_NODES) {
    predraw.pieces[predraw.count] = node;
    predraw.count += 1;

    return;
  }

  for (const child of children) if (!masksSibling(children, child)) cut(sctx, child);
}

/**
 * Cuts the next held top that still stands into its pieces. A stale slot (its view went, or it hangs under a building
 * parent by now) is passed over.
 *
 * @param sctx - Domain context of the sync module.
 * @returns False when no held top is left.
 */
function cutNext(sctx: SyncCtx): boolean {
  const { predraw, heldViews, views } = sctx.ctx.state.sync;

  while (predraw.next < heldViews.count) {
    const slot = predraw.next;
    const entity = heldViews.entities[slot] ?? 0;
    const view = views.get(entity);

    predraw.next += 1;

    if (view === undefined || !view.held) continue;

    predraw.slot = slot;
    predraw.entity = entity;
    predraw.top = view.wrapper ?? view.object;
    predraw.count = 0;
    predraw.head = 0;
    cut(sctx, predraw.top);

    return true;
  }

  return false;
}

/**
 * Tells whether a piece still belongs to the top it was cut from: the top is still the held top of its entity, and the
 * piece still hangs in it. A view that went, a pooled object and a new wrapper all fail it.
 *
 * @param sctx - Domain context of the sync module.
 * @param piece - The piece.
 * @returns True when it may be drawn.
 */
function stands(sctx: SyncCtx, piece: PixiContainer): boolean {
  const { predraw, views } = sctx.ctx.state.sync;
  const view = views.get(predraw.entity);
  const top = predraw.top;

  if (
    view === undefined ||
    !view.held ||
    top === undefined ||
    (view.wrapper ?? view.object) !== top
  ) {
    return false;
  }

  for (let node: PixiContainer | null = piece; node !== null; node = node.parent) {
    if (node === top) return !piece.destroyed;
  }

  return false;
}

/**
 * The next piece to draw. A piece whose top changed since the cut sends the cut back to that top's slot, once a call;
 * a piece of the new cut that still does not stand is passed over, so the walk always ends.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The piece, or `undefined` when every held top was drawn.
 */
function nextPiece(sctx: SyncCtx): PixiContainer | undefined {
  const predraw = sctx.ctx.state.sync.predraw;
  let recut = false;

  for (;;) {
    if (predraw.head < predraw.count) {
      const piece = predraw.pieces[predraw.head];

      if (piece !== undefined && stands(sctx, piece)) {
        predraw.head += 1;

        return piece;
      }

      if (recut) {
        predraw.head += 1;
        continue;
      }

      // The top changed since it was cut: it is cut again, as it stands now.
      recut = true;
      predraw.next = predraw.slot;
      predraw.count = 0;
      predraw.head = 0;
    }

    if (!cutNext(sctx)) return undefined;
  }
}

/**
 * Ends the pre-draw of the running build after a throw, logged at error level; the swap then draws as without it.
 *
 * @param sctx - Domain context of the sync module.
 * @param error - What was thrown.
 */
function failPredraw(sctx: SyncCtx, error: unknown): void {
  const predraw = sctx.ctx.state.sync.predraw;

  predraw.failed = true;
  predraw.count = 0;
  predraw.head = 0;
  sctx.ctx.log.error("renderer:predraw-failed", { error });
}

/**
 * The pre-draw's own target, made at its first piece on a device: the warm-up's target exists only after a warm frame
 * with `config.warm` above 0. A Pixi without render textures (a trimmed module) pre-draws nothing, as it keeps nothing;
 * one whose target throws ends the pre-draw of the build.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The target, or `undefined` when it cannot be made.
 */
function targetOf(sctx: SyncCtx): PixiRenderTexture | undefined {
  const predraw = sctx.ctx.state.sync.predraw;

  if (predraw.target !== undefined) return predraw.target;

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return undefined;

  if (typeof pixi.RenderTexture?.create !== "function") {
    predraw.failed = true;

    return undefined;
  }

  try {
    predraw.target = pixi.RenderTexture.create({
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      antialias: false,
      autoGarbageCollect: false,
      label: "renderer.predraw"
    });
  } catch (error) {
    failPredraw(sctx, error);
  }

  return predraw.target;
}

/**
 * Draws one piece into the target. The render group Pixi makes of a rendered container is taken away again; one the
 * piece was before (a kept picture's) stays. The monitor's counters of the frame are paused for the render: a piece is
 * load work of the build, no pass of the frame (the counting classes count only inside a frame).
 *
 * @param sctx - Domain context of the sync module.
 * @param piece - The piece.
 * @param target - The pre-draw target.
 * @returns False when the render threw: the pre-draw of the build ended.
 */
function drawPiece(sctx: SyncCtx, piece: PixiContainer, target: PixiRenderTexture): boolean {
  const sinks = sctx.ctx.state.monitor.sinks;
  const inFrame = sinks.inFrame;
  const grouped = piece.isRenderGroup;

  sinks.inFrame = false;

  try {
    sctx.deps.host.renderProbe(piece, target);

    return true;
  } catch (error) {
    failPredraw(sctx, error);

    return false;
  } finally {
    sinks.inFrame = inFrame;
    if (!grouped && piece.isRenderGroup) piece.disableRenderGroup();
  }
}

/**
 * The render phase's half of a scene build (the body of `SyncInternal.predrawStep`): reads and clears what the pass
 * made this frame, and once every building view is made, draws pieces of the held tops before the stage pass, at least
 * one and more while the frame has budget. Asks for the next frame while pieces wait. Two field reads and no
 * allocation with no build.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when this frame did building work: views made by the pass, or a piece drawn here.
 */
export function predrawStep(sctx: SyncCtx): boolean {
  const { aside, heldViews } = sctx.ctx.state.sync;
  const made = aside.made > 0;

  aside.made = 0;

  // per frame: no build, or views still to make, or nothing left to draw.
  if (heldViews.count === 0 || aside.head < aside.count || predrawDone(sctx)) return made;

  const target = targetOf(sctx);

  if (target === undefined) return made;

  const projection = sctx.ctx.deps.world.projection;
  let drawn = 0;

  do {
    const piece = nextPiece(sctx);

    if (piece === undefined || !drawPiece(sctx, piece, target)) break;

    drawn += 1;
  } while (projection.left() > 0);

  if (!predrawDone(sctx)) sctx.deps.demand.request();

  return made || drawn > 0;
}
