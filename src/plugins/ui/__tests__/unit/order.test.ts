import { describe, expect, it } from "vitest";
import { childOrder, SIBLING_SPAN } from "../../jsx/order";

// ---------------------------------------------------------------------------
// Spec 16 U1.1: the composite `Order` of a child element. Inside an element, bottom first: its
// own visual (depth −0.5), children with `zIndex` 0 in markup order, non-element children at
// `Order` 0 (hosted views), children with `zIndex` 1, and so on.
// ---------------------------------------------------------------------------

describe("childOrder", () => {
  // Bug: a child at zIndex 0 sorts under its parent's own visual, or over a view the parent hosts.
  it("sorts a child at index 0 above its parent's visual and under a hosted view at Order 0", () => {
    const order = childOrder(undefined, 0);

    expect(order).toBeGreaterThan(-0.5);
    expect(order).toBeLessThan(0);
  });

  // Bug (C1): a child mounted again by a condition draws over the siblings written after it.
  it("sorts a later sibling above an earlier one at the same zIndex, and under a higher zIndex", () => {
    expect(childOrder(1, 3)).toBeGreaterThan(childOrder(1, 2));
    expect(childOrder(1, 3)).toBeLessThan(childOrder(2, 0));
  });

  // Bug: the last sibling before the spill reaches the integer Order of a hosted view.
  it("keeps the last child before the spill under a non-element child at its integer Order", () => {
    expect(childOrder(0, SIBLING_SPAN - 2)).toBe(-0.000_122_070_312_5);
  });
});
