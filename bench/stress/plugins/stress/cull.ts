/**
 * @file Stress plugin — the culling experiments of change 2026-11-26-hot-path-research. Not for a merge: each is the
 * smallest stand-in for a way the engine could skip what is off the screen, switched by the address (`&cull=…`), so
 * one scene is measured with and without it.
 *
 * - `pixi`: every drawn leaf is `cullable` and Pixi's `Culler` runs before the render, as Pixi documents it.
 * - `pixitile`: only the containers of the tiles or pages are `cullable`, their children left out.
 * - `rect`: the bench tests each tile or page against the screen by its known place (as the engine would by its
 *   layout rect, with no Pixi bounds) and flips `renderable` only when the answer changes.
 * - `group`: the scrolled or dragged container is a Pixi render group, nothing is hidden.
 * - `rectgroup`: both.
 * - `window`: no code here: the overview is a windowed `<scroll rows>` (see `views.tsx`).
 */
import type { Ui } from "../../../../src/index.ts";
import { PAGE_WIDTH, PITCH } from "../../features/stress/views";
import type { Session } from "../../state";
import type { StressState } from "./types";

/** What the experiments read and write of a Pixi display object. */
export type CullNode = {
  label: string;
  parent?: CullNode | null;
  children?: CullNode[];
  renderable: boolean;
  cullable: boolean;
  cullableChildren: boolean;
  isRenderGroup: boolean;
  renderPipeId?: string;
};

/** The part of the Pixi module the experiments call. */
export type CullPixi = {
  Culler: {
    shared: { cull(container: CullNode, view: object, skipUpdateTransform?: boolean): void };
  };
};

/** What the experiments keep between frames. */
export type CullState = {
  /** The stage; `undefined` until the probe hangs. */
  stage: CullNode | undefined;
  /** The containers by their label, read again every 15 frames. */
  byLabel: Map<string, CullNode>;
  /** The tiles or pages an experiment tests, with the row or the page each stands for. */
  targets: Array<{ node: CullNode; index: number }>;
  /** Whether the leaves were marked cullable, and how many nodes the stage had then. */
  marked: number;
  /** The strip's x of this frame, written by the album's walk. */
  stripX: number;
  /** The scroll's offset of this frame, written by the scroll's walk. */
  offset: number;
  /** The screen in the stage's units, for Pixi's culler: read from the canvas with the stage. */
  screen: { x: number; y: number; width: number; height: number };
  /** `renderable` flips made so far. */
  flips: number;
  /** The page on show, the one beside it (-1 for none) and its side, as the walk's commits left them. */
  on: number;
  beside: number;
  side: number;
};

/** The height of a tile row with its gap, and where the first row starts on the screen at offset 0. */
const ROW_PITCH = 157 + 18;
const FIRST_ROW = 60 + 12;

/** The height of the screen in reference units. */
const SCREEN = 844;

/**
 * The state of experiments that have not run.
 *
 * @returns A fresh state.
 */
export function createCullState(): CullState {
  return {
    stage: undefined,
    byLabel: new Map(),
    targets: [],
    marked: 0,
    stripX: 0,
    offset: 0,
    screen: { x: 0, y: 0, width: 4096, height: 4096 },
    flips: 0,
    on: 0,
    beside: -1,
    side: 1
  };
}

/**
 * Reads the stage again: its containers by label, and with `leaves` every drawn leaf marked cullable.
 *
 * @param cull - The experiments' state.
 * @param leaves - Whether every leaf is marked `cullable`.
 */
function readStage(cull: CullState, leaves: boolean): void {
  const { stage } = cull;

  if (stage === undefined) return;

  const canvas = document.querySelector("canvas");

  if (canvas !== null) {
    cull.screen.width = canvas.clientWidth;
    cull.screen.height = canvas.clientHeight;
  }

  cull.byLabel.clear();

  const stack: CullNode[] = [stage];
  let count = 0;

  while (stack.length > 0) {
    const node = stack.pop() as CullNode;

    count += 1;
    if (node.label !== "") cull.byLabel.set(node.label, node);
    if (leaves && node.renderPipeId !== undefined) node.cullable = true;

    for (const child of node.children ?? []) stack.push(child);
  }

  cull.marked = count;
}

/**
 * The container of a keyed element: the wrapper the renderer hangs its children in.
 *
 * @param cull - The experiments' state.
 * @param ui - The ui: its `find`.
 * @param key - The element's key.
 * @returns The container; `undefined` when the element is not shown or has no children.
 */
function containerOf(
  cull: CullState,
  ui: Pick<Ui.UiApi, "find">,
  key: string
): CullNode | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = ui.find(key);

  return entity === undefined ? undefined : cull.byLabel.get(`parent#${entity}`);
}

/**
 * Finds what the scene's experiments test: the rows of tiles of the overview, or the pages of the strip.
 *
 * @param cull - The experiments' state.
 * @param ui - The ui.
 * @param session - The session of the page.
 * @param on - The page on show, and the one beside it; -1 for none.
 * @param beside - The second page of the strip.
 */
function readTargets(
  cull: CullState,
  ui: Pick<Ui.UiApi, "find">,
  session: Session,
  on: number,
  beside: number
): void {
  cull.targets.length = 0;

  if (session.scene === "scroll") {
    for (let row = 0; row < Math.ceil(session.sets / 3); row += 1) {
      const node = containerOf(cull, ui, `tileRow${row}`);

      if (node !== undefined) cull.targets.push({ node, index: row });
    }

    return;
  }

  for (const page of [on, beside]) {
    const node = page < 0 ? undefined : containerOf(cull, ui, `page${page}`);

    if (node !== undefined) cull.targets.push({ node, index: page });
  }
}

/**
 * Whether a target is on the screen, by its known place: a row of the overview by the scroll's offset, a page of the
 * strip by the strip's x.
 *
 * @param cull - The experiments' state.
 * @param session - The session of the page.
 * @param index - The row, or the page.
 * @param on - The page on show.
 * @param side - The side of the page beside it.
 * @returns True when any of it shows.
 */
function isShown(
  cull: CullState,
  session: Session,
  index: number,
  on: number,
  side: number
): boolean {
  if (session.scene === "scroll") {
    const top = FIRST_ROW + index * ROW_PITCH - cull.offset;

    return top + ROW_PITCH > 60 && top < SCREEN;
  }

  const left = 21 + cull.stripX + (index === on ? 0 : side * PITCH);

  return left + PAGE_WIDTH > 0 && left < 390;
}

/**
 * Reads the stage and the targets again, and sets what an experiment sets once: the render group, or the cullable
 * containers.
 *
 * @param cull - The experiments' state.
 * @param ui - The ui.
 * @param session - The session of the page.
 * @param mode - The experiment.
 */
function prepare(
  cull: CullState,
  ui: Pick<Ui.UiApi, "find">,
  session: Session,
  mode: string
): void {
  readStage(cull, mode === "pixi");
  readTargets(cull, ui, session, cull.on, cull.beside);

  if (mode === "group" || mode === "rectgroup") {
    const moved = containerOf(cull, ui, session.scene === "scroll" ? "tileRows" : "pages");

    if (moved !== undefined && !moved.isRenderGroup) moved.isRenderGroup = true;
  }

  if (mode !== "pixitile") return;

  for (const target of cull.targets) {
    target.node.cullable = true;
    target.node.cullableChildren = false;
  }
}

/**
 * One frame of the experiment the address names, after the renderer's sync and before the draw.
 *
 * @param state - The driver's state.
 * @param pixi - The Pixi module.
 * @param ui - The ui.
 * @param session - The session of the page: its scene and its experiment.
 */
export function cullFrame(
  state: StressState,
  pixi: CullPixi,
  ui: Pick<Ui.UiApi, "find">,
  session: Session
): void {
  const { cull } = state;
  const mode = session.cull;

  if (mode === "" || mode === "window" || cull.stage === undefined) return;

  if (state.step % 15 === 1) prepare(cull, ui, session, mode);

  if (mode === "pixi" || mode === "pixitile") {
    pixi.Culler.shared.cull(cull.stage, cull.screen, false);

    return;
  }

  if (mode === "rect" || mode === "rectgroup") {
    for (const target of cull.targets) {
      const shown = isShown(cull, session, target.index, cull.on, cull.side);

      if (target.node.renderable !== shown) {
        target.node.renderable = shown;
        cull.flips += 1;
      }
    }
  }
}
