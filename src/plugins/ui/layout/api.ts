/**
 * @file ui/layout — the module factory: the Yoga lifetime, the solve, the rest pose and the two
 * fx handlers. It is injected into `jsx`; nothing it returns reaches the public API.
 */
import type { FxHandler } from "../../flow/fx/types";
import type { Hint } from "../../flow/types";
import { Text } from "../../text/components";
import type { Time } from "../../time/types";
import type { Motion, ViewHandle } from "../../world/projection/types";
import type { MotionCause } from "../../world/types";
import { Box } from "../components";
import type { Element, JsxModule } from "../jsx/types";
import type { UiCtx } from "../types";
import { applyStyleToNode, layoutChanged } from "./apply";
import { beginExit, canDespawn } from "./exit";
import { createGuideHandler } from "./guide";
import { iconLineMoved, installMeasure, markMeasured, remeasureShown } from "./measure";
import {
  enterPosed,
  liftRest,
  play,
  playExtraChange,
  poseEnter,
  repose,
  startLoop,
  writeRest
} from "./motion";
import { createNode, freeNode, placeChildren } from "./nodes";
import { createPopupHandler } from "./popup";
import { clampScroll, scrollTo, settleScroll, stepScroll } from "./scroll";
import { contentRectOf, solveRoot } from "./solve";
import type {
  ElementLookup,
  LayoutModule,
  LayoutState,
  MotionSpan,
  Rect,
  TextSource
} from "./types";
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
    measure: (content, style, width) => ctx.deps.text.measure(content, style, width),
    resolved: entity => ctx.deps.world.ecs.get(entity, Text)?.resolved,
    duration: ms => ctx.deps.i18n.duration(ms)
  };
}

/**
 * Writes the style of an element onto its node and keeps its measure function in step. An `x`
 * scroll lays its content out the way a row does: along `x`, as wide as it is, as tall as the
 * scroll.
 *
 * @param state - The layout state.
 * @param source - What a text element is measured through.
 * @param element - The element to write.
 */
function writeStyle(state: LayoutState, source: TextSource, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined || state.yoga === undefined) return;

  const tag = element.scroll?.axis === "x" ? "row" : element.type;

  applyStyleToNode(state.yoga, node, element.style, tag, element.parentType);
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
  // Per frame (a root in a slot reads it at every solve): one box, written in place.
  const contentBox: Rect = { x: 0, y: 0, w: 0, h: 0 };

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

    iconLineMoved: (): boolean => iconLineMoved(state, source),

    markMeasured: (element: Element): void => markMeasured(state, element),

    place: (parent: Element, children: readonly Element[]): void =>
      placeChildren(state, parent, children),

    free: (element: Element): void => freeNode(state, element),

    solve: (rootElement: Element, size: Rect, lookup: ElementLookup): boolean =>
      solveRoot(state, rootElement, size, lookup),

    contentRect: (element: Element): Rect => contentRectOf(state, element, contentBox),

    commit: (element: Element, parent: Rect | undefined): void => {
      if (element.live) ctx.deps.world.ecs.set(element.entity, Box, element.rect);

      writeRest(ctx, element, parent);
    },

    enter: (element: Element, span?: MotionSpan): void => {
      const hook = element.motion?.enter;
      const played =
        hook === undefined
          ? undefined
          : (view: ViewHandle<unknown>) => hook(view, element.node, undefined, element.cause);

      if (!enterPosed(ctx, element, span)) play(ctx, element, played, span);
      // The loop is for the element's life, not its arrival: it starts whatever the cause.
      startLoop(ctx, element);
    },

    pose: (element: Element, span?: MotionSpan): void => poseEnter(ctx, element, span),

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

    exit: (element: Element, cause: MotionCause, span?: MotionSpan, stands?: boolean): void =>
      beginExit(ctx, state, element, cause, span, stands),

    playTrack: (element: Element, hook: (view: ViewHandle<unknown>) => Motion): void => {
      play(ctx, element, hook);
    },

    settled: (element: Element): boolean => canDespawn(element),

    scroll: (containers: readonly Element[], lookup: ElementLookup, time: Readonly<Time>): void =>
      stepScroll(ctx, state, containers, lookup, time),

    settleScroll: (
      containers: readonly Element[],
      lookup: ElementLookup,
      time: Readonly<Time>
    ): void => settleScroll(ctx, state, containers, lookup, time),

    clampScroll: (container: Element, contentHeight: number, lookup: ElementLookup): number =>
      clampScroll(ctx, state, container, contentHeight, lookup),

    scrollTo: (container: Element, to: number, lookup: ElementLookup): boolean =>
      scrollTo(ctx, state, container, to, lookup),

    windowOf,

    popupHandler: (jsx: JsxModule): FxHandler => createPopupHandler(ctx, state, jsx),

    guideHandler: (): FxHandler => createGuideHandler(ctx),

    counters: () => ({ nodes: state.nodes, measured: state.measured, solves: state.solves })
  };
}
