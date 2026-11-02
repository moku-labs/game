import { describe, expect, it } from "vitest";
import type { Element } from "../../jsx/types";
import { applyStyleToNode } from "../../layout/apply";
import { createNode, placeChildren } from "../../layout/nodes";
import { solveRoot } from "../../layout/solve";
import { createLayoutState } from "../../layout/state";
import { loadYogaModule } from "../../layout/yoga";

/**
 * An element the layout helpers read: its entity, tag, style, rect and children.
 *
 * @param entity - Its entity.
 * @param patch - What differs.
 * @returns The element.
 */
function element(entity: number, patch: Partial<Element>): Element {
  return {
    entity,
    type: "column",
    style: {},
    rect: { x: 0, y: 0, w: 0, h: 0 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    fit: 1,
    moved: false,
    children: [],
    parentType: undefined,
    ...patch
  } as unknown as Element;
}

describe("an anchor in the flow of its parent", () => {
  it("takes no room among its siblings and keeps the rect the anchor pass gave it", async () => {
    // Bug caught: the anchor is laid out as a child of its column, so a sibling moves down by the
    // target's height, and the root's solve writes the anchor over the place of its targets.
    const state = createLayoutState();
    const yoga = await loadYogaModule();
    const root = element(1, { style: { width: 300, height: 600 }, children: [2, 3] });
    const anchor = element(2, { type: "anchor", rect: { x: 500, y: 700, w: 116, h: 120 } });
    const button = element(3, { type: "button", style: { width: 100, height: 50 } });
    const elements = new Map([root, anchor, button].map(entry => [entry.entity, entry]));

    state.yoga = yoga;

    for (const entry of elements.values()) {
      createNode(state, entry);

      const node = state.byEntity.get(entry.entity);

      if (node !== undefined) applyStyleToNode(yoga, node, entry.style, entry.type, undefined);
    }

    // The anchor pass sizes the anchor's own tree to its targets.
    state.byEntity.get(2)?.setWidth(116);
    state.byEntity.get(2)?.setHeight(120);
    placeChildren(state, root, [anchor, button]);
    solveRoot(state, root, { x: 0, y: 0, w: 1080, h: 1920 }, entity => elements.get(entity));

    expect(button.rect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(anchor.rect).toEqual({ x: 500, y: 700, w: 116, h: 120 });
  });
});
