import { describe, expect, it } from "vitest";
import { focusRoot, readingOrder } from "../../jsx/focus";
import { zIndexOnRoot } from "../../jsx/lint";
import type { Element, JsxState, Root } from "../../jsx/types";

/**
 * Builds a root the focus reads: a projection root, or a popup root when `popup` is set.
 *
 * @param patch - What to change about it.
 * @returns The root.
 */
function rootOf(patch: Partial<Root>): Root {
  return {
    entity: 1,
    name: "hud",
    tree: { type: "row", props: {}, children: [] },
    layer: "ui",
    order: 0,
    dirty: false,
    needsSolve: false,
    element: 100,
    popup: undefined,
    covered: false,
    ...patch
  };
}

/**
 * Builds the two parts of the jsx state `focusRoot` reads.
 *
 * @param roots - The mounted roots.
 * @param removing - The roots on their way out.
 * @returns The state.
 */
function stateOf(roots: Root[], removing: number[] = []): JsxState {
  return {
    roots: new Map(roots.map(root => [root.entity, root])),
    removing: new Set(removing)
  } as unknown as JsxState;
}

describe("readingOrder", () => {
  it("reads the upper rect first, and on the same top the left one", () => {
    const rects = [
      { x: 0, y: 100, w: 10, h: 10 },
      { x: 500, y: 0, w: 10, h: 10 },
      { x: 110, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 10, h: 10 }
    ];

    expect(rects.toSorted(readingOrder).map(rect => [rect.x, rect.y])).toEqual([
      [0, 0],
      [110, 0],
      [500, 0],
      [0, 100]
    ]);
  });
});

describe("focusRoot", () => {
  it("answers nothing when nothing is mounted", () => {
    expect(focusRoot(stateOf([]), ["ui"])).toBeUndefined();
  });

  it("takes the last screen root, the one in the top layer, when no popup is open", () => {
    const board = rootOf({ entity: 1, layer: "board" });
    const hud = rootOf({ entity: 2, layer: "ui" });

    expect(focusRoot(stateOf([hud, board]), ["board", "ui"])?.entity).toBe(2);
  });

  it("takes the first uncovered popup over every screen root", () => {
    const hud = rootOf({ entity: 1 });
    const settings = rootOf({ entity: 2, order: 1, covered: true, popup: { close: () => 0 } });
    const confirm = rootOf({ entity: 3, order: 2, popup: { close: () => 0 } });

    expect(focusRoot(stateOf([hud, settings, confirm]), ["ui"])?.entity).toBe(3);
    expect(focusRoot(stateOf([hud, settings]), ["ui"])?.entity).toBe(1);
  });

  it("skips a root on its way out and a root with no element yet", () => {
    const hud = rootOf({ entity: 1 });
    const leaving = rootOf({ entity: 2, order: 1, popup: { close: () => 0 } });
    const empty = rootOf({ entity: 3, element: undefined });

    expect(focusRoot(stateOf([hud, leaving, empty], [2]), ["ui"])?.entity).toBe(1);
  });
});

describe("zIndexOnRoot", () => {
  it("reports a root element that sets zIndex and nothing else", () => {
    const root = { key: "board", type: "column", parent: undefined, style: { zIndex: 2 } };
    const child = { key: "strip", type: "row", parent: 5, style: { zIndex: 1 } };

    expect(zIndexOnRoot(root as unknown as Element)).toEqual({
      rule: "z-index-on-root",
      key: "board",
      detail: "zIndex 2"
    });
    expect(zIndexOnRoot(child as unknown as Element)).toBeUndefined();
    expect(zIndexOnRoot({ ...root, style: {} } as unknown as Element)).toBeUndefined();
  });
});
