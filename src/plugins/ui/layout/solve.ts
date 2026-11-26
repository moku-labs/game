/**
 * @file ui/layout — one `calculateLayout` per marked root, then the walk that turns the computed
 * offsets into rects in root coordinates. Never per frame, never on scroll. An element with
 * `fit: "contain"` is laid out at its own size, out of the flow, then centred in the content box
 * of its parent with the scale that fits it; its children keep their natural rects.
 */
import type { Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../jsx/types";
import { ANCHOR } from "../visual";
import type { ElementLookup, LayoutState, Rect } from "./types";

/**
 * Where the children of a parent are placed: its own rect, and the part of it inside its padding.
 */
type Frame = { origin: { x: number; y: number }; content: Rect };

/**
 * Centres a box of a natural size in a content box and finds the scale that fits it there.
 *
 * @param content - The content box of the parent, in root coordinates.
 * @param width - The natural width of the fitted element.
 * @param height - The natural height of the fitted element.
 * @returns The natural rect, centred, and the fit scale: never above 1, 0 when there is no room.
 * @example
 * ```ts
 * fitInto({ x: 20, y: 320, w: 1040, h: 776 }, 970, 970);
 * // { rect: { x: 55, y: 223, w: 970, h: 970 }, fit: 0.8 }
 * ```
 */
export function fitInto(content: Rect, width: number, height: number): { rect: Rect; fit: number } {
  const fit = width > 0 && height > 0 ? Math.min(1, content.w / width, content.h / height) : 1;

  return {
    rect: {
      x: content.x + (content.w - width) / 2,
      y: content.y + (content.h - height) / 2,
      w: width,
      h: height
    },
    fit: Math.max(0, fit)
  };
}

/**
 * Where the children of one element are placed, by depth: the walk writes the frame of a depth in place, so a solve
 * builds no frame (F244). A child reads its parent's frame before its own children overwrite the next depth.
 *
 * @param state - The layout state, which keeps the frames.
 * @param depth - The depth of the element whose children are placed.
 * @returns The frame of that depth.
 */
function frameAt(state: LayoutState, depth: number): Frame {
  const frames = state.frames;
  const kept = frames[depth];

  if (kept !== undefined) return kept;

  // A depth reached for the first time makes its frame; every later solve there reuses it.
  const made: Frame = { origin: { x: 0, y: 0 }, content: { x: 0, y: 0, w: 0, h: 0 } };

  frames[depth] = made;

  return made;
}

/**
 * Writes the frame the children of an element are placed in: its rect, less its computed padding.
 *
 * @param state - The layout state, for the edge enums of Yoga.
 * @param frame - The frame written.
 * @param rect - The rect of the element.
 * @param node - Its Yoga node.
 */
function writeFrame(state: LayoutState, frame: Frame, rect: Rect, node: YogaNode): void {
  const yoga = state.yoga;
  const left = yoga === undefined ? 0 : node.getComputedPadding(yoga.EDGE_LEFT);
  const top = yoga === undefined ? 0 : node.getComputedPadding(yoga.EDGE_TOP);
  const right = yoga === undefined ? 0 : node.getComputedPadding(yoga.EDGE_RIGHT);
  const bottom = yoga === undefined ? 0 : node.getComputedPadding(yoga.EDGE_BOTTOM);

  frame.origin.x = rect.x;
  frame.origin.y = rect.y;
  frame.content.x = rect.x + left;
  frame.content.y = rect.y + top;
  frame.content.w = rect.w - left - right;
  frame.content.h = rect.h - top - bottom;
}

/**
 * Gives an element the rect the solve found. A rect that stayed is kept, so an element whose rect did not move costs
 * no object; a moved one gets a new rect, and the one it had becomes its `previous`. The element is stamped with the
 * solve when the application has work on it: a new rect or fit, a parent that moved (its rest pose is relative to the
 * parent), or its first application. It `slid` when it moved with its parent by the same step and kept its size and
 * fit: its rest pose and its visual stay what they were, only its `Box` moves.
 *
 * @param state - The layout state, for the number of this solve.
 * @param element - The element placed.
 * @param x - Its x in root coordinates.
 * @param y - Its y.
 * @param width - Its width.
 * @param height - Its height.
 * @param fit - Its fit scale.
 * @param step - How far its parent moved, x then y; `NaN` for a root, whose rest pose is its rect: a root never slides
 *   and is always stamped.
 * @returns True when its rect or its fit scale changed.
 */
function settle(
  state: LayoutState,
  element: Element,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: number,
  step: Float64Array
): boolean {
  // What moved: the rect, the size, the fit, and how far the parent went.
  const before = element.rect;
  const sized = before.w === width && before.h === height;
  const moved = before.x !== x || before.y !== y || !sized;
  const fitted = fit !== element.fit;
  const stepX = step[0] ?? Number.NaN;
  const stepY = step[1] ?? Number.NaN;
  const withParent = x - before.x === stepX && y - before.y === stepY;
  const parentMoved = stepX !== 0 || stepY !== 0;

  // The move is recorded; a rect that stayed keeps its object.
  element.moved = moved;
  element.slid = moved && sized && !fitted && withParent;
  element.fit = fit;

  if (moved) moveRect(element, x, y, width, height);

  // The application's work: a root's step is `NaN`, so a root is always stamped.
  const hasWork = moved || fitted || !element.live || parentMoved;

  if (hasWork) element.placed = state.solves;

  return moved || fitted;
}

/**
 * Gives a moved element its new rect; the one it had becomes its `previous`. The rect before that is written over
 * and becomes the new one, so a move builds nothing: every component value is a copy, and only the element holds its
 * two rects. An element with a `change.Box` hook gets a new rect: the hook is handed both and may keep them (F244).
 *
 * @param element - The element that moved.
 * @param x - Its new x in root coordinates.
 * @param y - Its new y.
 * @param width - Its new width.
 * @param height - Its new height.
 */
function moveRect(element: Element, x: number, y: number, width: number, height: number): void {
  const before = element.rect;
  const spare = element.previous;
  const handedOut = element.motion?.change?.Box !== undefined || spare === before;
  const next = handedOut ? { x, y, w: width, h: height } : spare;

  next.x = x;
  next.y = y;
  next.w = width;
  next.h = height;
  element.previous = before;
  element.rect = next;
}

/**
 * Moves every rect of a subtree Yoga did not lay out again by the step its parent moved: its rects relative to the
 * parent stand, so none of its nodes is read. An `<anchor>` and everything under it are left to the anchor pass, an
 * element without a node is left as it is: the walk of `place` leaves them the same way.
 *
 * @param state - The layout state, for the node of each element and the number of this solve.
 * @param element - The top of the subtree.
 * @param step - How far the parent moved, x then y: not 0.
 * @param lookup - How a child entity becomes its element.
 */
function slide(
  state: LayoutState,
  element: Element,
  step: Float64Array,
  lookup: ElementLookup
): void {
  if (element.type === ANCHOR || !state.byEntity.has(element.entity)) return;

  const before = element.rect;

  moveRect(element, before.x + (step[0] ?? 0), before.y + (step[1] ?? 0), before.w, before.h);
  element.moved = true;
  element.slid = true;
  element.placed = state.solves;

  for (const child of element.children) {
    const childElement = lookup(child);

    if (childElement !== undefined) slide(state, childElement, step, lookup);
  }
}

/**
 * Walks the element tree and writes the rect of every element Yoga laid out again, in root coordinates. A child Yoga
 * passed over (`hasNewLayout` false) stands where it stood relative to its parent, and so does all of its subtree: it
 * is skipped when the parent stayed, and moved by the parent's step when the parent moved, with no node read (F244:
 * the album's overview of 312 elements under a set page cost a read of eight Yoga values each at every page turn). An
 * `<anchor>` and everything under it are left to the anchor pass, which places them by their targets.
 *
 * @param state - The layout state, for the node of each element.
 * @param element - The element to place.
 * @param depth - The depth of its parent: the frame there is where the parent sits and its content box.
 * @param step - How far its parent moved, x then y; `NaN` for a root.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect or fit scale changed.
 */
function place(
  state: LayoutState,
  element: Element,
  depth: number,
  step: Float64Array,
  lookup: ElementLookup
): boolean {
  const node = state.byEntity.get(element.entity);

  if (node === undefined || element.type === ANCHOR) return false;

  const frame = frameAt(state, depth);
  const width = node.getComputedWidth();
  const height = node.getComputedHeight();
  const content = frame.content;
  let x = frame.origin.x + node.getComputedLeft();
  let y = frame.origin.y + node.getComputedTop();
  let fit = 1;

  if (element.style.fit === "contain") {
    // `fitInto`, inline: no rect is built for an element whose rect may not move.
    fit =
      width > 0 && height > 0 ? Math.max(0, Math.min(1, content.w / width, content.h / height)) : 1;
    x = content.x + (content.w - width) / 2;
    y = content.y + (content.h - height) / 2;
  }

  node.markLayoutSeen();

  const fromX = element.rect.x;
  const fromY = element.rect.y;
  const changed = settle(state, element, x, y, width, height, fit, step);

  if (element.children.length === 0) return changed;

  writeFrame(state, frameAt(state, depth + 1), element.rect, node);

  // The step of this element for its children, kept by depth: a child's own walk writes the next one.
  const own = stepAt(state, depth + 1);

  own[0] = x - fromX;
  own[1] = y - fromY;

  return placeChildren(state, element, depth + 1, own, lookup) || changed;
}

/**
 * Places the children of a placed element: one Yoga laid out again is placed, one it passed over is moved with its
 * subtree by the element's step, or left where it stands when the element stayed. A child whose subtree has work for
 * the application stamps the element, so the application reaches it.
 *
 * @param state - The layout state.
 * @param element - The placed element.
 * @param depth - The depth of its children: the frame there is the element's.
 * @param own - How far the element moved, x then y.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect or fit scale under it changed.
 */
function placeChildren(
  state: LayoutState,
  element: Element,
  depth: number,
  own: Float64Array,
  lookup: ElementLookup
): boolean {
  let changed = false;

  for (const child of element.children) {
    const childElement = lookup(child);

    if (childElement === undefined) continue;
    if (placeOrSlide(state, childElement, depth, own, lookup)) changed = true;

    // A subtree with work for the application stamps its parent, so the application reaches it.
    if (childElement.placed === state.solves) element.placed = state.solves;
  }

  return changed;
}

/**
 * Places one child: Yoga laid it out again, so its rect is read; or Yoga passed it over, so its subtree stands relative
 * to its parent and is moved by the parent's step, or left alone when the parent stayed.
 *
 * @param state - The layout state.
 * @param element - The child.
 * @param depth - Its depth: the frame there is its parent's.
 * @param own - How far its parent moved, x then y.
 * @param lookup - How a child entity becomes its element.
 * @returns True when a rect or a fit scale in its subtree changed.
 */
function placeOrSlide(
  state: LayoutState,
  element: Element,
  depth: number,
  own: Float64Array,
  lookup: ElementLookup
): boolean {
  const node = state.byEntity.get(element.entity);
  const passedOver = node !== undefined && !node.hasNewLayout();

  if (!passedOver) return place(state, element, depth, own, lookup);

  const parentStayed = own[0] === 0 && own[1] === 0;

  if (parentStayed) return false;

  slide(state, element, own, lookup);

  return true;
}

/**
 * The step of the elements at one depth, how far their parent moved, kept by depth like the frames.
 *
 * @param state - The layout state, which keeps the steps.
 * @param depth - The depth.
 * @returns The step there: x, then y.
 */
function stepAt(state: LayoutState, depth: number): Float64Array {
  const kept = state.steps[depth];

  if (kept !== undefined) return kept;

  const made = new Float64Array(2);

  state.steps[depth] = made;

  return made;
}

/** The step of a root: it has no parent, so its move is never a slide. */
const ROOT_STEP = new Float64Array([Number.NaN, Number.NaN]);

/**
 * Solves one root and writes every rect under it.
 *
 * @param state - The layout state.
 * @param rootElement - The element that carries the tree.
 * @param size - The rect the root is solved in: the viewport, for a screen and for a popup.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect changed.
 */
export function solveRoot(
  state: LayoutState,
  rootElement: Element,
  size: Rect,
  lookup: ElementLookup
): boolean {
  const node = state.byEntity.get(rootElement.entity);

  if (state.yoga === undefined || node === undefined) return false;

  // Whole units rounded up: Yoga rounds a root of 874.31 to 874, and a full-screen fill would stop short of the
  // frame's last device row (F116). What reaches past the frame is less than one unit, off the canvas.
  node.calculateLayout(Math.ceil(size.w), Math.ceil(size.h), state.yoga.DIRECTION_LTR);
  state.solves += 1;

  // The root is placed in the box it is solved in.
  const frame = frameAt(state, 0);

  frame.origin.x = size.x;
  frame.origin.y = size.y;
  frame.content.x = size.x;
  frame.content.y = size.y;
  frame.content.w = size.w;
  frame.content.h = size.h;

  return place(state, rootElement, 0, ROOT_STEP, lookup);
}

/**
 * The content box of an element in its own units: its rect less its computed padding, at the
 * padding's top-left corner. A JSX root laid out in a slot is solved in it (spec 16 U3.4). Without
 * Yoga or a node it is the whole box at 0, 0.
 *
 * @param state - The layout state, for the node of the element and the edge enums of Yoga.
 * @param element - The element, a slot.
 * @param into - The rect written; a new one when left out.
 * @returns The content box: `into` itself when given.
 */
export function contentRectOf(state: LayoutState, element: Element, into?: Rect): Rect {
  const box = into ?? { x: 0, y: 0, w: 0, h: 0 };
  const node = state.byEntity.get(element.entity);
  const yoga = state.yoga;

  box.x = 0;
  box.y = 0;
  box.w = element.rect.w;
  box.h = element.rect.h;

  if (node === undefined || yoga === undefined) return box;

  // Per solve of a slotted root: the padding read straight into the box, no frame built.
  const left = node.getComputedPadding(yoga.EDGE_LEFT);
  const top = node.getComputedPadding(yoga.EDGE_TOP);

  box.x = left;
  box.y = top;
  box.w = element.rect.w - left - node.getComputedPadding(yoga.EDGE_RIGHT);
  box.h = element.rect.h - top - node.getComputedPadding(yoga.EDGE_BOTTOM);

  return box;
}
