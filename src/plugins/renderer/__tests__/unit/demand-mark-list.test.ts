import { describe, expect, it } from "vitest";
import { MarkList } from "../../demand/marks";

// ---------------------------------------------------------------------------
// Unit: the mark list of a decision (audit row 20 of change 2026-10-18-cheap-idle-tick): what a `Set` gave its readers,
// emptied by a new decision number instead of a new table.
// ---------------------------------------------------------------------------

describe("a mark list", () => {
  it("keeps each entity once, in mark order, and forgets every one when emptied", () => {
    const marks = new MarkList();

    for (const entity of [3, 1, 3]) marks.add(entity);

    expect([marks.size, [...marks], marks.has(3), marks.at(1)]).toEqual([2, [3, 1], true, 1]);

    marks.clear();

    expect([marks.size, marks.has(3), marks.has(1), [...marks]]).toEqual([0, false, false, []]);

    marks.add(1);

    expect([marks.size, marks.has(1), marks.has(3), [...marks]]).toEqual([1, true, false, [1]]);
  });

  it("stays right after an emptying that dropped its stamps for the entities that came and went", () => {
    const marks = new MarkList();

    for (let entity = 1; entity <= 1100; entity += 1) marks.add(entity);
    marks.clear();
    marks.add(5);

    expect([marks.size, marks.has(5), marks.has(6), marks.has(1100)]).toEqual([
      1,
      true,
      false,
      false
    ]);
  });
});
