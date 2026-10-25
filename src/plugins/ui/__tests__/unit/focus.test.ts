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
    cause: undefined,
    slot: undefined,
    slotRect: undefined,
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

/**
 * Tells the root of the board from every other: the board is the scene built aside.
 *
 * @param entity - A root entity.
 * @returns True for the board's root.
 */
function isBoard(entity: number): boolean {
  return entity === 2;
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

  // Bug: the HUD layer draws after `ui`, so its resource panel or its toasts take every Escape and
  // every Back press, and no sheet closes.
  it("never gives the keyboard to a root of the HUD layer: the top sheet under it takes it", () => {
    const ward = rootOf({ entity: 1, layer: "scene" });
    const shop = rootOf({ entity: 2, layer: "ui" });
    const resources = rootOf({ entity: 3, layer: "hud" });
    const toast = rootOf({ entity: 4, layer: "hud" });
    const layers = ["scene", "ui", "hud"];

    expect(focusRoot(stateOf([ward, shop, resources, toast]), layers, "hud")?.entity).toBe(2);
    expect(focusRoot(stateOf([ward, resources, toast]), layers, "hud")?.entity).toBe(1);
    expect(focusRoot(stateOf([resources]), layers, "hud")).toBeUndefined();
  });

  // Bug: the coming scene's root sorts last, its layer not in the list yet, and takes Tab and Escape
  // while it is built aside, unseen.
  it("never gives the keyboard to a root of a scene built aside", () => {
    const ward = rootOf({ entity: 1, layer: "ui" });
    const board = rootOf({ entity: 2, layer: "board" });

    expect(focusRoot(stateOf([ward, board]), ["ui"], undefined, isBoard)?.entity).toBe(1);
  });

  // Bug: a scene with no HUD layer loses its top root to the HUD rule, by the name of a layer.
  it("gives it to the root in the top layer as before when the scene has no HUD layer", () => {
    const shop = rootOf({ entity: 1, layer: "ui" });
    const resources = rootOf({ entity: 2, layer: "hud" });

    expect(focusRoot(stateOf([resources, shop]), ["ui", "hud"])?.entity).toBe(2);
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
