/**
 * @file ui/layout — the module factory: the Yoga lifetime, the solve, the rest pose and the two
 * fx handlers. It is injected into `jsx`; nothing it returns reaches the public API.
 */
import type { FxHandler } from "../../flow/fx/types";
import { Box } from "../components";
import type { Element, JsxModule } from "../jsx/types";
import type { UiCtx } from "../types";
import { applyStyleToNode, layoutChanged } from "./apply";
import { beginExit, canDespawn } from "./exit";
import { createGuideHandler } from "./guide";
import { installMeasure, markMeasured } from "./measure";
import { play, repose, writeRest } from "./motion";
import { createNode, freeNode, placeChildren } from "./nodes";
import { createPopupHandler } from "./popup";
import { stepScroll } from "./scroll";
import { solveRoot } from "./solve";
import type { ElementLookup, LayoutModule, LayoutState, Rect } from "./types";
import { loadYogaModule } from "./yoga";

/**
 * Writes the style of an element onto its node and keeps its measure function in step.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state.
 * @param element - The element to write.
 */
function writeStyle(ctx: UiCtx, state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined || state.yoga === undefined) return;

  applyStyleToNode(state.yoga, node, element.style, element.type, element.parentType);
  installMeasure(state, node, element, ctx.deps.text.measure);
}

/**
 * Builds the layout module.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The module, for `jsx` and the lifecycle.
 */
export function createLayoutApi(ctx: UiCtx): LayoutModule {
  const state = ctx.state.layout;

  return {
    load: async (): Promise<void> => {
      state.yoga = await loadYogaModule();
    },

    loaded: () => state.yoga !== undefined,

    attach: (element: Element): void => {
      createNode(state, element);
      writeStyle(ctx, state, element);
    },

    affectsRect: layoutChanged,

    applyStyle: (element: Element): void => {
      writeStyle(ctx, state, element);
      markMeasured(state, element);
    },

    place: (parent: Element, children: readonly Element[]): void =>
      placeChildren(state, parent, children),

    free: (element: Element): void => freeNode(state, element),

    solve: (rootElement: Element, size: Rect, lookup: ElementLookup): boolean =>
      solveRoot(state, rootElement, size, lookup),

    commit: (element: Element, parent: Rect | undefined): void => {
      if (element.live) ctx.deps.world.ecs.set(element.entity, Box, element.rect);

      writeRest(ctx, element, parent);
    },

    enter: (element: Element): void => {
      const hook = element.motion?.enter;

      play(ctx, element, hook === undefined ? undefined : view => hook(view, element.node));
    },

    change: (element: Element, previous: Rect): boolean => {
      const hook = element.motion?.change?.Box;

      if (hook === undefined) return false;

      play(ctx, element, view => hook(view, previous, element.rect));

      return true;
    },

    repose: (element: Element, parent: Rect | undefined, hooked: boolean): void =>
      repose(ctx, element, parent, hooked),

    exit: (element: Element): void => beginExit(ctx, state, element),

    settled: (element: Element): boolean => canDespawn(element),

    scroll: (containers: readonly Element[], lookup: ElementLookup): void =>
      stepScroll(ctx, state, containers, lookup),

    popupHandler: (jsx: JsxModule): FxHandler => createPopupHandler(ctx, state, jsx),

    guideHandler: (): FxHandler => createGuideHandler(ctx),

    counters: () => ({ nodes: state.nodes, measured: state.measured, solves: state.solves })
  };
}
