/**
 * @file ui/layout — vertical scroll: while the container is pressed the content moves with the
 * finger through one `Transform` write. No solve, no motion — the children keep their rects. A
 * windowed scroll knows its content height from `rows × rowHeight`, so its range is kept even
 * when no finger is on it.
 */
import { Pointer, Pressed } from "../../input/components";
import { Transform } from "../../renderer/components";
import { Scroll, type ScrollValue } from "../components";
import type { Element } from "../jsx/types";
import type { UiCtx } from "../types";
import type { ElementLookup, LayoutState } from "./types";

/**
 * Keeps an offset inside the scrollable range: never below the end of the content, never above
 * the top.
 *
 * @param offset - Where the content would go.
 * @param min - The most negative offset, which is viewport height minus content height.
 * @returns The offset the content is written with.
 * @example
 * ```ts
 * clampOffset(40, -300); // 0
 * ```
 */
export function clampOffset(offset: number, min: number): number {
  return Math.min(0, Math.max(min, offset));
}

/**
 * The content entity of a scroll container: its single child.
 *
 * @param container - The scroll element.
 * @param lookup - How a child entity becomes its element.
 * @returns The content element, or `undefined`.
 */
function contentOf(container: Element, lookup: ElementLookup): Element | undefined {
  const first = container.children[0];

  return first === undefined ? undefined : lookup(first);
}

/**
 * The height of what a container scrolls: `rows × rowHeight` for a windowed scroll, which equals
 * its solved content rect, else the solved content rect.
 *
 * @param container - The scroll element.
 * @param content - Its content element.
 * @returns The height in reference units.
 */
function contentHeightOf(container: Element, content: Element): number {
  const window = container.window;

  return window === undefined ? content.rect.h : window.rows * window.rowHeight;
}

/**
 * Writes an offset and the range it was clamped to, and moves the content there.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param container - The scroll element.
 * @param content - Its content element.
 * @param scroll - What its `Scroll` holds now.
 */
function moveContent(ctx: UiCtx, container: Element, content: Element, scroll: ScrollValue): void {
  const ecs = ctx.deps.world.ecs;

  ecs.set(container.entity, Scroll, { offset: scroll.offset, min: scroll.min });
  ecs.set(content.entity, Transform, { y: content.rect.y - container.rect.y + scroll.offset });
}

/**
 * Keeps the offset of a scroll inside the range its content height gives, and writes that range,
 * when either moved: a windowed list whose rows shrank, or its first solve.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param container - The scroll element, with a solved rect.
 * @param content - Its content element.
 * @param contentHeight - The height of what it scrolls.
 * @returns The offset the content stands at.
 */
function keepInRange(
  ctx: UiCtx,
  container: Element,
  content: Element,
  contentHeight: number
): number {
  const scroll = ctx.deps.world.ecs.get(container.entity, Scroll);

  if (scroll === undefined) return 0;

  const min = Math.min(0, container.rect.h - contentHeight);
  const offset = clampOffset(scroll.offset, min);

  if (offset !== scroll.offset || min !== scroll.min) {
    moveContent(ctx, container, content, { ...scroll, offset, min });
  }

  return offset;
}

/**
 * Re-clamps a live windowed scroll to the content height of its new rows before its range is
 * cut, so a list that shrank below the window moves up in the same frame.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param container - The live scroll element.
 * @param contentHeight - `rows × rowHeight` of this render.
 * @param lookup - How a child entity becomes its element.
 * @returns The offset the content stands at.
 */
export function clampScroll(
  ctx: UiCtx,
  container: Element,
  contentHeight: number,
  lookup: ElementLookup
): number {
  const content = contentOf(container, lookup);

  if (content === undefined) return ctx.deps.world.ecs.get(container.entity, Scroll)?.offset ?? 0;

  return keepInRange(ctx, container, content, contentHeight);
}

/**
 * Moves the content of every pressed scroll container with the finger. A windowed container no
 * finger is on keeps its offset inside the range of its rows.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which remembers where the drag started.
 * @param containers - The live scroll elements.
 * @param lookup - How a child entity becomes its element.
 */
export function stepScroll(
  ctx: UiCtx,
  state: LayoutState,
  containers: readonly Element[],
  lookup: ElementLookup
): void {
  const ecs = ctx.deps.world.ecs;
  const pointer = ecs.resource(Pointer);

  for (const container of containers) {
    const scroll = ecs.get(container.entity, Scroll);
    const content = contentOf(container, lookup);

    if (scroll === undefined || content === undefined) continue;

    if (!ecs.has(container.entity, Pressed)) {
      if (state.scrolling === container.entity) state.scrolling = undefined;
      if (container.window !== undefined) {
        keepInRange(ctx, container, content, contentHeightOf(container, content));
      }

      continue;
    }

    if (state.scrolling !== container.entity) {
      state.scrolling = container.entity;
      state.scrollStart = { pointerY: pointer.y, offset: scroll.offset };
    }

    const min = Math.min(0, container.rect.h - contentHeightOf(container, content));
    const offset = clampOffset(
      state.scrollStart.offset + (pointer.y - state.scrollStart.pointerY),
      min
    );

    moveContent(ctx, container, content, { ...scroll, offset, min });
  }
}
