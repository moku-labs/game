import { describe, expect, it } from "vitest";
import { eachEntity, isEmptyList } from "../../sync/each";

// ---------------------------------------------------------------------------
// Unit: the walk of a change list (R4 of change 2026-10-18-cheap-idle-tick). The world answers arrays; a copy the rare
// steps make is a `Set`: both are read whole and in order.
// ---------------------------------------------------------------------------

describe("a change list", () => {
  it("is walked in order and told empty or not, an array and a Set alike", () => {
    const seen: number[] = [];

    eachEntity([3, 1], entity => seen.push(entity));
    eachEntity(new Set([7, 5]), entity => seen.push(entity));

    expect(seen).toEqual([3, 1, 7, 5]);
    expect([
      isEmptyList([]),
      isEmptyList([1]),
      isEmptyList(new Set()),
      isEmptyList(new Set([1]))
    ]).toEqual([true, false, true, false]);
  });
});
