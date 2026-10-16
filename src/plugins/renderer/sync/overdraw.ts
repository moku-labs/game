/**
 * @file renderer/sync — the overdraw heat map of a dev or debug build (U6): `debug.overdraw(true)` draws every frame
 * so that a pixel's brightness counts the layers drawn there. Only the stage pass of a drawn frame is drawn that way:
 * right before it every node under the root gets the overdraw state, right after it every node gets its own state
 * back, from a restore table filled in the same call; between frames, where the game, the oracles and the editor read
 * the tree, it is the tree as it is. Kept pictures draw live for that pass (`kept.live`), filters are off, and the
 * caller asks a frame every frame, so a still screen is drawn too.
 *
 * The overdraw state, public Pixi API only: every node blends `"add-npm"`, whose alpha is additive, every layer
 * (a child of the root) draws at alpha 1/16 and every node under it at alpha 1 (0 stays 0), so a drawn texel adds 1/16
 * of its own alpha to the frame's alpha wherever it covers; one `ColorMatrixFilter` on the root then shows that
 * alpha as grey: one layer is 1/16 white, three are 3/16, sixteen and more are white. Texels a texture leaves
 * transparent add nothing.
 */
import type { PixiContainer, PixiFilter, PixiModule } from "../types";
import type { OverdrawState, SyncCtx } from "./types";

/** The 4x5 matrix a `ColorMatrixFilter` takes. */
type ColorMatrix = InstanceType<PixiModule["ColorMatrixFilter"]>["matrix"];

/** The alpha one layer adds: 16 layers make white. */
export const LAYER_ALPHA = 1 / 16;

/** The blend mode whose alpha adds up: `src + dst`. */
const ADDITIVE = "add-npm";

/**
 * The colour matrix of the heat map: red, green and blue are the frame's alpha, the alpha is 1. Rows of five: the
 * weights of red, green, blue and alpha, and an offset.
 *
 * @returns A fresh matrix.
 */
function alphaToGrey(): ColorMatrix {
  return [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
}

/**
 * Creates the overdraw state: off, an empty restore table, no matrix yet.
 *
 * @returns The state.
 */
export function createOverdrawState(): OverdrawState {
  return {
    nodes: [],
    alphas: [],
    blends: [],
    filters: [],
    rootFilters: undefined,
    matrix: undefined,
    listeners: []
  };
}

/**
 * The filters a node holds now: Pixi answers `undefined` before the first write and `null` after a clear.
 *
 * @param node - The node.
 * @returns The filters, or `undefined` when it holds none.
 */
function heldBy(node: PixiContainer): readonly PixiFilter[] | undefined {
  const held: readonly PixiFilter[] | null | undefined = node.filters;

  return held === null || held === undefined || held.length === 0 ? undefined : held;
}

/**
 * Notes a node's alpha, blend mode and filters in the restore table and gives it the overdraw state.
 *
 * @param state - The overdraw state.
 * @param node - The node.
 * @param alpha - Its overdraw alpha when it draws at all.
 */
function swapNode(state: OverdrawState, node: PixiContainer, alpha: number): void {
  const filters = heldBy(node);

  state.nodes.push(node);
  state.alphas.push(node.alpha);
  state.blends.push(node.blendMode);
  state.filters.push(filters);

  if (node.alpha > 0) node.alpha = alpha;
  node.blendMode = ADDITIVE;
  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  if (filters !== undefined) node.filters = null;
}

/**
 * Gives a subtree the overdraw state, a node that is not drawn (invisible, or not renderable) left as it is with its
 * children.
 *
 * @param state - The overdraw state.
 * @param top - The subtree's top.
 * @param alpha - The top's overdraw alpha.
 */
function swapTree(state: OverdrawState, top: PixiContainer, alpha: number): void {
  const open: PixiContainer[] = [top];

  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    if (!node.visible || !node.renderable) continue;

    swapNode(state, node, node === top ? alpha : 1);

    for (const child of node.children) open.push(child);
  }
}

/**
 * The colour matrix of the heat map, made once per Pixi module.
 *
 * @param state - The overdraw state.
 * @param pixi - The Pixi module.
 * @returns The filter.
 */
function matrixOf(state: OverdrawState, pixi: PixiModule): PixiFilter {
  if (state.matrix !== undefined) return state.matrix;

  const matrix = new pixi.ColorMatrixFilter();

  matrix.matrix = alphaToGrey();
  state.matrix = matrix;

  return matrix;
}

/**
 * Puts every node back as the restore table holds it, the root's filters last; the table is empty after.
 *
 * @param state - The overdraw state.
 * @param root - The root.
 */
function restoreAll(state: OverdrawState, root: PixiContainer): void {
  for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
    const node = state.nodes[index];

    if (node === undefined) continue;

    node.alpha = state.alphas[index] ?? 1;
    node.blendMode = state.blends[index] ?? "inherit";

    const filters = state.filters[index];

    if (filters !== undefined) node.filters = [...filters];
  }

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  root.filters = state.rootFilters === undefined ? null : [...state.rootFilters];
  state.nodes.length = 0;
  state.alphas.length = 0;
  state.blends.length = 0;
  state.filters.length = 0;
  state.rootFilters = undefined;
}

/**
 * Draws the stage pass as the overdraw heat map: every kept picture live, every layer and node in the overdraw state
 * and the matrix on the root for the one `render` call, and everything back right after it, also when it throws.
 * Without a root or a Pixi module it only renders.
 *
 * @param sctx - Domain context of the sync module.
 * @param render - The stage pass.
 * @returns What `render` answered.
 */
export function drawOverdraw(sctx: SyncCtx, render: () => boolean): boolean {
  const { root } = sctx.ctx.state.sync;
  const pixi = sctx.deps.host.pixi();

  if (root === undefined || pixi === undefined) return render();

  const state = sctx.ctx.state.sync.overdraw;

  return sctx.deps.kept.live(() => {
    try {
      state.rootFilters = heldBy(root);

      for (const layer of root.children) swapTree(state, layer, LAYER_ALPHA);

      root.filters = [matrixOf(state, pixi)];

      return render();
    } finally {
      restoreAll(state, root);
    }
  });
}
