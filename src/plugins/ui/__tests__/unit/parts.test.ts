import { describe, expect, it, vi } from "vitest";
import { createParts, type PartsReconcile } from "../../jsx/parts";
import { createJsxState } from "../../jsx/state";
import type { DescriptionNode, Element, Root } from "../../jsx/types";
import type { UiCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the parts of a scene build (spec 33 A3) at their own seam. In the app a parked element
// cannot leave before its part runs: its root is not diffed again while parts wait, and its
// windowed ranges do not move. The part's own check is the last line if one ever does, so it is
// driven here: the element is dropped the way `dropElement` drops it, then the queue is drained.
// ---------------------------------------------------------------------------

/** The entity of the root built aside. */
const ROOT = 100;

/**
 * A root built aside, mounted and reconciled.
 *
 * @returns The root.
 */
function rootOf(): Root {
  return {
    entity: ROOT,
    name: "parts.big",
    tree: { type: "column", props: {}, children: [] },
    layer: "ui",
    order: 0,
    dirty: false,
    needsSolve: false,
    element: 1,
    popup: undefined,
    covered: false,
    cause: "change",
    slot: undefined,
    slotRect: undefined,
    aside: true
  };
}

/**
 * An element of the root, not live yet.
 *
 * @param entity - Its entity.
 * @returns The element.
 */
function elementOf(entity: number): Element {
  return {
    entity,
    identity: `${ROOT}|e${entity}|row`,
    type: "row",
    key: `e${entity}`,
    parentType: "column",
    root: ROOT,
    node: { type: "row", props: {}, children: [] },
    style: {},
    is: {
      pressed: false,
      hover: false,
      focus: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    },
    rect: { x: 0, y: 0, w: 0, h: 0 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: true,
    fit: 1,
    rest: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    handles: [],
    loop: undefined,
    motion: undefined,
    parent: 1,
    children: [],
    instance: undefined,
    live: false,
    entered: false,
    dropKey: undefined,
    extras: new Map(),
    extraHandles: new Map(),
    warnedOwned: new Set(),
    warned: new Set(),
    index: 0,
    cause: "change",
    rebuilds: 0,
    scrolledIn: false
  };
}

/** The children a parked element would have diffed. */
const NODES: readonly DescriptionNode[] = [{ type: "stack", key: "dot", props: {}, children: [] }];

/**
 * The parts over a jsx state with one root built aside, on a budget that is spent at its first
 * read, and the diff the reconcile lends, as a spy.
 *
 * @returns The parts, the state, the root, the diff spy and the error log.
 */
function harness() {
  const jsx = createJsxState();
  const error = vi.fn();
  const ctx = {
    state: { jsx },
    log: { error },
    deps: { world: { projection: { left: () => 0, isBuilding: () => true } } }
  } as unknown as UiCtx;
  const diffChildren = vi.fn<PartsReconcile["diffChildren"]>();
  const parts = createParts(ctx, { diffChildren, applyElement: vi.fn(), isMoving: () => false });
  const root = rootOf();

  jsx.roots.set(ROOT, root);
  jsx.asideRoots = 1;

  return { parts, jsx, root, diffChildren, error };
}

describe("a parked part whose element left before it ran", () => {
  // Bug: the part of an element its parent's newer render dropped is diffed all the same: its
  // children are made under a despawned parent, and the frame's first unit goes to nothing.
  it("is dropped without a diff, and the next part takes the frame's first unit", () => {
    const { parts, jsx, root, diffChildren, error } = harness();
    const gone = elementOf(2);
    const kept = elementOf(3);

    jsx.elements.set(gone.entity, gone);
    jsx.elements.set(kept.entity, kept);
    parts.park(root, gone, NODES, undefined);
    parts.park(root, kept, NODES, undefined);

    // Its parent rendered again without it: `dropElement` forgot it.
    jsx.elements.delete(gone.entity);

    parts.beginReconcile();
    expect(() => parts.drainParked()).not.toThrow();

    expect(diffChildren.mock.calls.map(call => call[1])).toEqual([kept]);
    expect(error).not.toHaveBeenCalled();
    expect(root.parked).toEqual([]);
    expect(parts.waits(root)).toBe(false);
  });
});
