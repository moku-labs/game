/**
 * @file ui/layout — the module factory: the Yoga lifetime, the solve, the rest pose and the two
 * fx handlers. It is injected into `jsx`; nothing it returns reaches the public API.
 */
import type { FxHandler } from "../../flow/fx/types";
import type { Hint } from "../../flow/types";
import { Text } from "../../text/components";
import { Box } from "../components";
import type { Element, JsxModule } from "../jsx/types";
import type { UiCtx } from "../types";
import { applyStyleToNode, layoutChanged } from "./apply";
import { beginExit, canDespawn } from "./exit";
import { createGuideHandler } from "./guide";
import { installMeasure, markMeasured, remeasureShown } from "./measure";
import { liftRest, play, playExtraChange, repose, startLoop, writeRest } from "./motion";
import { createNode, freeNode, placeChildren } from "./nodes";
import { createPopupHandler } from "./popup";
import { clampScroll, stepScroll } from "./scroll";
import { solveRoot } from "./solve";
import type { ElementLookup, LayoutModule, LayoutState, Rect, TextSource } from "./types";
import { windowOf } from "./window";
import { loadYogaModule } from "./yoga";

/**
 * What the text elements are measured through: `text.measure`, the string `text` resolved for an
 * entity, and the duration words of `i18n`.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The source every measure function reads.
 */
function textSourceOf(ctx: UiCtx): TextSource {
  return {
    measure: (content, style) => ctx.deps.text.measure(content, style),
    resolved: entity => ctx.deps.world.ecs.get(entity, Text)?.resolved,
    duration: ms => ctx.deps.i18n.duration(ms)
  };
}

/**
 * Writes the style of an element onto its node and keeps its measure function in step.
 *
 * @param state - The layout state.
 * @param source - What a text element is measured through.
 * @param element - The element to write.
 */
function writeStyle(state: LayoutState, source: TextSource, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined || state.yoga === undefined) return;

  applyStyleToNode(state.yoga, node, element.style, element.type, element.parentType);
  installMeasure(state, node, element, source);
}

/**
 * Builds the layout module.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The module, for `jsx` and the lifecycle.
 */
export function createLayoutApi(ctx: UiCtx): LayoutModule {
  const state = ctx.state.layout;
  const source = textSourceOf(ctx);

  return {
    load: async (): Promise<void> => {
      state.yoga = await loadYogaModule();
    },

    loaded: () => state.yoga !== undefined,

    attach: (element: Element): void => {
      createNode(state, element);
      writeStyle(state, source, element);
    },

    affectsRect: layoutChanged,

    applyStyle: (element: Element): void => {
      writeStyle(state, source, element);
      markMeasured(state, element);
    },

    remeasure: (element: Element): boolean => remeasureShown(state, element, source),

    markMeasured: (element: Element): void => markMeasured(state, element),

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
      startLoop(ctx, element);
    },

    loop: (element: Element): void => startLoop(ctx, element),

    change: (element: Element, previous: Rect, hint?: Hint): boolean => {
      const hook = element.motion?.change?.Box;

      if (hook === undefined) return false;

      play(ctx, element, view => hook(view, previous, element.rect, hint));

      return true;
    },

    changeExtra: (
      element: Element,
      name: string,
      values: { previous: object; next: object },
      hint: Hint | undefined
    ): boolean => playExtraChange(ctx, element, name, values, hint),

    repose: (element: Element, parent: Rect | undefined, hooked: boolean, hint?: Hint): void =>
      repose(ctx, element, parent, hooked, hint),

    lift: (element: Element, units: number): void => liftRest(ctx, element, units),

    exit: (element: Element): void => beginExit(ctx, state, element),

    settled: (element: Element): boolean => canDespawn(element),

    scroll: (containers: readonly Element[], lookup: ElementLookup): void =>
      stepScroll(ctx, state, containers, lookup),

    clampScroll: (container: Element, contentHeight: number, lookup: ElementLookup): number =>
      clampScroll(ctx, container, contentHeight, lookup),

    windowOf,

    popupHandler: (jsx: JsxModule): FxHandler => createPopupHandler(ctx, state, jsx),

    guideHandler: (): FxHandler => createGuideHandler(ctx),

    counters: () => ({ nodes: state.nodes, measured: state.measured, solves: state.solves })
  };
}
