/**
 * @file renderer/kept — the bounds of what a subtree draws, in its top's own space. Pixi's `getLocalBounds` counts
 * every visible node, also one the engine hides with `renderable = false` (alpha 0, a cover, an overlay's range, a
 * kept child's top), which Pixi then never draws (F58). This walk skips a node as Pixi's live filter bounds do
 * (`localDisplayStatus`, `measurable`), keeps masks and bounds areas, and allocates nothing once its per-depth
 * matrices and bounds exist. Those and the answered bounds are module scratch, as `NOW` of `record.ts`: one walk at a
 * time, and the next walk writes the answer again.
 */
import type { PixiBounds, PixiContainer, PixiMatrix, PixiModule } from "../types";

/** Every flag of a node's display status: visible, renderable, not culled (Pixi's `localDisplayStatus`). */
const SHOWN = 0b111;

/** The matrix of each depth of the walk, from the top's space to the node's. Grown once, then reused. */
const MATRICES: PixiMatrix[] = [];

/** The bounds a masked node's subtree is gathered in, one per depth. Grown once, then reused. */
const MASKED: PixiBounds[] = [];

/** A node that draws itself: Pixi's view containers hold their own bounds, which `Container` does not type. */
type ViewNode = PixiContainer & {
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

/** The bounds the last walk answered, made once. */
const RESULT: PixiBounds[] = [];

/**
 * The matrix of a depth, made the first time the walk reaches it.
 *
 * @param pixi - The module that draws.
 * @param depth - The depth under the top.
 * @returns The matrix.
 */
function matrixAt(pixi: PixiModule, depth: number): PixiMatrix {
  const known = MATRICES[depth];

  if (known !== undefined) return known;

  const made = new pixi.Matrix();

  MATRICES[depth] = made;

  return made;
}

/**
 * The bounds a masked node of a depth gathers its subtree in, made the first time the walk needs it.
 *
 * @param pixi - The module that draws.
 * @param depth - The depth under the top.
 * @returns The bounds, cleared.
 */
function maskedAt(pixi: PixiModule, depth: number): PixiBounds {
  const known = MASKED[depth];

  if (known !== undefined) return known.clear();

  const made = new pixi.Bounds();

  MASKED[depth] = made;

  return made;
}

/**
 * Tells whether Pixi skips a node and its subtree: hidden, not renderable, culled, or not measured (a mask).
 *
 * @param node - A node under the top.
 * @returns True when it adds nothing.
 */
function skipped(node: PixiContainer): boolean {
  return node.localDisplayStatus !== SHOWN || !node.measurable;
}

/**
 * Adds what a node draws itself and what its children draw to the bounds, under the node's matrix.
 *
 * @param pixi - The module that draws.
 * @param node - The node, shown.
 * @param into - The bounds so far.
 * @param depth - Its depth under the top.
 * @param top - The top.
 */
function addContent(
  pixi: PixiModule,
  node: PixiContainer,
  into: PixiBounds,
  depth: number,
  top: PixiContainer
): void {
  const matrix = matrixAt(pixi, depth);

  if (node.boundsArea) {
    into.addRect(node.boundsArea, matrix);

    return;
  }

  if (node.renderPipeId !== undefined) {
    const own = (node as ViewNode).bounds;

    into.addFrame(own.minX, own.minY, own.maxX, own.maxY, matrix);
  }

  const children = node.children;

  // per take: the children walked by index, no iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    if (child !== undefined) addDrawn(pixi, child, into, depth + 1, top);
  }
}

/**
 * Adds what one node and its subtree draw to the bounds, in the top's space. The top itself is never skipped: it is
 * the root of the picture's render, drawn whatever its own flags say. A masked node gathers its subtree apart, then
 * the mask cuts it.
 *
 * @param pixi - The module that draws.
 * @param node - The node.
 * @param into - The bounds so far.
 * @param depth - Its depth under the top, 0 for the top.
 * @param top - The top: the space of the bounds, and the root a mask is measured from.
 */
function addDrawn(
  pixi: PixiModule,
  node: PixiContainer,
  into: PixiBounds,
  depth: number,
  top: PixiContainer
): void {
  if (depth > 0 && skipped(node)) return;

  // The node's matrix in the top's space: the top's is the identity.
  const matrix = matrixAt(pixi, depth);

  if (depth === 0) {
    matrix.identity();
  } else {
    node.updateLocalTransform();
    matrix.appendFrom(node.localTransform, matrixAt(pixi, depth - 1));
  }

  // A node with no effects adds what it draws straight.
  const effects = node.effects ?? [];

  if (effects.length === 0) {
    addContent(pixi, node, into, depth, top);

    return;
  }

  // A masked node gathers what it draws apart, then its masks cut it.
  const masked = maskedAt(pixi, depth);

  addContent(pixi, node, masked, depth, top);

  for (const effect of effects) effect.addLocalBounds?.(masked, top);

  if (masked.isValid) into.addFrame(masked.minX, masked.minY, masked.maxX, masked.maxY);
}

/**
 * The bounds of what a subtree draws, in its top's own space: no node Pixi skips, masks applied.
 *
 * @param pixi - The module that draws.
 * @param top - The top of the subtree.
 * @returns The bounds, one object the next walk writes again; empty (`isValid` false) when nothing is drawn.
 */
export function drawnBounds(pixi: PixiModule, top: PixiContainer): Readonly<PixiBounds> {
  const into = RESULT[0] ?? new pixi.Bounds();

  RESULT[0] = into;
  into.clear();
  addDrawn(pixi, top, into, 0, top);

  return into;
}
