/**
 * @file ui/jsx — the windowed scroll at run time: the range its rows are cut to when it mounts, at
 * every patch and at every frame the finger moves it; the slots and the two spacers it holds; the
 * row height every row is laid out at; and a row that leaves the window, dropped at once instead
 * of exiting. The reconcile owns the diff and the teardown and lends them in.
 */
import type { Entity } from "../../world/types";
import { Scroll } from "../components";
import { asError } from "../errors";
import type { LayoutModule, RowRange } from "../layout/types";
import type { ResolvedStyle, Style } from "../styles/types";
import type { UiCtx } from "../types";
import { CONTENT } from "../visual";
import { forgetInstances } from "./instances";
import type { DescriptionNode, Element, JsxChild, Root, ScrollWindow } from "./types";
import {
  BOTTOM_SPACER,
  emptySlot,
  isOwnKey,
  rowStyleOf,
  slotOf,
  spacerNode,
  TOP_SPACER,
  windowFormOf
} from "./window";

/**
 * What the range step borrows from the reconcile it belongs to: the diff of a list against the
 * slots of its new window, and the two teardown steps a row that leaves the window goes through.
 */
export type RangeReconcile = {
  /** Diffs the content of a live windowed scroll against the slots of its new window. */
  diffSlots(root: Root, scroll: Element, slots: DescriptionNode[]): void;
  /** Drops the identity, the key and the key registration of an element and everything under it. */
  forgetSubtree(element: Element): void;
  /** Despawns an element and everything under it, and frees the Yoga nodes. */
  despawnTree(element: Element): void;
};

/**
 * Builds the windowed-scroll half of the reconcile: the row style, the slots a mount or a patch
 * holds, the range step of every frame and the drop of a row that left the window.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param layout - The layout module: it clamps the offset and cuts the range.
 * @param reconcile - The diff and the teardown the reconcile lends.
 * @returns The steps the reconcile calls.
 */
export function createRange(ctx: UiCtx, layout: LayoutModule, reconcile: RangeReconcile) {
  const state = ctx.state.jsx;
  const ecs = ctx.deps.world.ecs;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);

  // The windowed scroll whose range is moving right now: while it is set, a row that leaves its
  // content is dropped at once and an element that enters plays no `enter` hook.
  let windowing: Entity | undefined;

  /**
   * Logs one warning or error of an element once for its whole life, by event name.
   *
   * @param element - The element the log is about.
   * @param event - The event name, also what makes it once.
   * @param data - The payload.
   * @param level - `warn`, or `error` for a broken row.
   */
  function logOnce(
    element: Element,
    event: string,
    data: Record<string, unknown>,
    level: "warn" | "error" = "warn"
  ): void {
    if (element.warned.has(event)) return;

    element.warned.add(event);

    if (level === "error") ctx.log.error(event, data);
    else ctx.log.warn(event, data);
  }

  /**
   * The windowed scroll whose rows the children of an element are: set when the element is the
   * content of a windowed scroll.
   *
   * @param parent - The parent of the element being placed.
   * @returns The scroll, or `undefined`.
   */
  function windowedScrollOf(parent: Element | undefined): Element | undefined {
    if (parent?.type !== CONTENT || parent.parent === undefined) return undefined;

    const scroll = lookup(parent.parent);

    return scroll?.window === undefined ? undefined : scroll;
  }

  /**
   * The style an element is laid out with, from the style it resolved to. A row of a windowed
   * scroll is laid out at the row height, whatever its style says; a row style with another
   * height is one warning per scroll.
   *
   * @param parent - The parent of the element.
   * @param node - The node of this render.
   * @param style - The style the element resolved to.
   * @returns The style.
   */
  function rowStyle(
    parent: Element | undefined,
    node: DescriptionNode,
    style: ResolvedStyle
  ): ResolvedStyle {
    const scroll = windowedScrollOf(parent);

    if (scroll?.window === undefined || isOwnKey(node.key)) return style;

    const { rowHeight } = scroll.window;

    if (style.height !== undefined && style.height !== rowHeight) {
      logOnce(scroll, "ui:row-height-overridden", { key: scroll.key ?? scroll.identity });
    }

    return rowStyleOf(style, rowHeight);
  }

  /**
   * The height a windowed scroll cuts its first range with, before it has a rect: its style's
   * height when that is a number, else the viewport's. The range step corrects it after the solve.
   *
   * @param element - The scroll that is entering.
   * @returns The height in reference units.
   */
  function mountHeightOf(element: Element): number {
    const height = element.style.height;

    return typeof height === "number" ? height : ctx.deps.renderer.viewport.size().height;
  }

  /**
   * The node of one spacer of a windowed scroll. The node of the last render is kept while its
   * height holds, so a re-render with the same range writes no style and asks for no solve.
   *
   * @param scroll - The windowed scroll.
   * @param key - `TOP_SPACER` or `BOTTOM_SPACER`.
   * @param height - Its height now.
   * @returns The node.
   */
  function spacerOf(scroll: Element, key: string, height: number): DescriptionNode {
    const content = scroll.children[0] === undefined ? undefined : lookup(scroll.children[0]);
    const at = key === TOP_SPACER ? content?.children[0] : content?.children.at(-1);
    const spacer = at === undefined ? undefined : lookup(at);
    const style = spacer?.node.props.style as Style | undefined;

    return spacer?.key === key && style?.height === height ? spacer.node : spacerNode(key, height);
  }

  /**
   * The slots of a windowed scroll's window: the top spacer, `row(index)` for every index of the
   * range, the bottom spacer. A row that is not one node is one error per scroll, and an empty
   * slot of the row height stands in for it.
   *
   * @param scroll - The windowed scroll.
   * @param window - The window it is about to hold.
   * @returns The slots, top to bottom.
   */
  function slotsOf(scroll: Element, window: ScrollWindow): DescriptionNode[] {
    const { rows, rowHeight, first, last } = window;
    const row = scroll.node.props.row as (index: number) => JsxChild;
    const slots = [spacerOf(scroll, TOP_SPACER, first * rowHeight)];

    for (let index = first; index <= last; index += 1) {
      const slot = slotOf(row(index), index);

      if (slot === undefined) {
        logOnce(
          scroll,
          "ui:row-not-one-node",
          { key: scroll.key ?? scroll.identity, index },
          "error"
        );
      }

      slots.push(slot ?? emptySlot(index, rowHeight));
    }

    slots.push(spacerOf(scroll, BOTTOM_SPACER, (rows - last - 1) * rowHeight));

    return slots;
  }

  /**
   * The slots the content of an element holds instead of the markup's children. A windowed
   * scroll reads its props, re-clamps its offset to the height of its rows, cuts the range at that
   * offset and holds the slots of it; the offset of a scroll that has not solved yet is 0. Any
   * other element holds no window.
   *
   * @param element - The element, its node of this render already set.
   * @returns The slots, top spacer to bottom spacer, or `undefined` for the markup's children.
   */
  function slotsFor(element: Element): DescriptionNode[] | undefined {
    const props = element.type === "scroll" ? windowFormOf(element.node) : undefined;

    if (props === undefined) {
      delete element.window;

      return undefined;
    }

    const name = element.key ?? element.identity;

    if (props.rounded) logOnce(element, "ui:scroll-rows-rounded", { key: name });
    if (element.node.children.length > 0) {
      logOnce(element, "ui:scroll-children-ignored", { key: name });
    }

    const height = element.live ? element.rect.h : mountHeightOf(element);
    const offset = element.live
      ? layout.clampScroll(element, props.rows * props.rowHeight, lookup)
      : 0;
    const range = layout.windowOf(offset, height, props.rows, props.rowHeight, props.overscan);
    const window = {
      rows: props.rows,
      rowHeight: props.rowHeight,
      overscan: props.overscan,
      ...range
    };

    const slots = slotsOf(element, window);

    element.window = window;

    return slots;
  }

  /**
   * Drops a row that left the window of a windowed scroll: its keys and its instances are
   * forgotten, so its local state is lost, and the subtree despawns and frees its Yoga nodes now.
   * No `exit` hook plays and nothing is tagged `Exiting`: leaving the window is not a removal.
   *
   * @param element - The row that left the window.
   */
  function dropRow(element: Element): void {
    reconcile.forgetSubtree(element);
    forgetInstances(state, element.identity);
    reconcile.despawnTree(element);
  }

  /**
   * Moves the window of a windowed scroll to a new range: only the list's subtree is diffed, on
   * the stored node of the scroll, so no view above it runs. Rows that leave are dropped, rows that
   * enter play no `enter` hook, and the root solves once.
   *
   * @param root - The root of the scroll.
   * @param scroll - The live windowed scroll.
   * @param window - The window it held.
   * @param range - The range it holds now.
   */
  function moveWindow(root: Root, scroll: Element, window: ScrollWindow, range: RowRange): void {
    const moved = { ...window, ...range };

    windowing = scroll.entity;

    try {
      // The window moves only once every row of it was built: a row callback that throws leaves
      // the list as it was, and the next range step tries again.
      const slots = slotsOf(scroll, moved);

      scroll.window = moved;
      reconcile.diffSlots(root, scroll, slots);
    } finally {
      windowing = undefined;
    }

    root.needsSolve = true;
    state.windowRenders += 1;
  }

  /**
   * The range step: every live windowed scroll cuts its range at this frame's offset, after the
   * scroll step and before any root is diffed, so a row never arrives one frame late. A range that
   * moved re-renders the list; a row callback that throws fails that root alone.
   *
   * @param containers - The live scroll containers of this frame.
   */
  function step(containers: readonly Element[]): void {
    for (const scroll of containers) {
      const window = scroll.window;
      const root = state.roots.get(scroll.root);
      const isGone = !state.scrolls.has(scroll.entity) || !state.elements.has(scroll.entity);

      if (window === undefined || root === undefined || isGone) continue;
      if (state.removing.has(root.entity)) continue;

      const offset = ecs.get(scroll.entity, Scroll)?.offset ?? 0;
      const { rows, rowHeight, overscan } = window;
      const range = layout.windowOf(offset, scroll.rect.h, rows, rowHeight, overscan);

      if (range.first === window.first && range.last === window.last) continue;

      try {
        moveWindow(root, scroll, window, range);
      } catch (error) {
        ctx.log.error("ui:root-failed", { root: root.name }, asError(error));
      }
    }
  }

  /**
   * Tells whether a range is moving right now: an element that enters then was scrolled in, and
   * plays no `enter` hook.
   *
   * @returns True while the range step diffs a list.
   */
  function isMoving(): boolean {
    return windowing !== undefined;
  }

  /**
   * Tells whether the children an element leaves out are rows a range change took out: true for
   * the content of the windowed scroll whose range is moving.
   *
   * @param parent - The element whose children are diffed.
   * @returns True when a child it leaves out is dropped, not exited.
   */
  function dropsRowsOf(parent: Element): boolean {
    return windowing !== undefined && parent.parent === windowing;
  }

  return { rowStyle, slotsFor, step, dropRow, isMoving, dropsRowsOf };
}
