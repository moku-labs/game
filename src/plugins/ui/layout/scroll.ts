/**
 * @file ui/layout — vertical scroll: while the container is pressed the content moves with the
 * finger through one `Transform` write. No solve, no motion — the children keep their rects.
 */
import { Pointer, Pressed } from "../../input/components";
import { Transform } from "../../renderer/components";
import { Scroll } from "../components";
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
 * Moves the content of every pressed scroll container with the finger.
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

      continue;
    }

    if (state.scrolling !== container.entity) {
      state.scrolling = container.entity;
      state.scrollStart = { pointerY: pointer.y, offset: scroll.offset };
    }

    const min = Math.min(0, container.rect.h - content.rect.h);
    const offset = clampOffset(
      state.scrollStart.offset + (pointer.y - state.scrollStart.pointerY),
      min
    );

    ecs.set(container.entity, Scroll, { offset, min });
    ecs.set(content.entity, Transform, { y: content.rect.y - container.rect.y + offset });
  }
}
