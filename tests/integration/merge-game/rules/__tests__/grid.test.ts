import { describe, expect, it } from "vitest";
import {
  findFreeCell,
  itemAt,
  itemById,
  neighbors,
  replaceItem,
  withItem,
  withoutItem
} from "../grid";
import type { Board } from "../types";
import { deepFreeze, filledItems, midGameState } from "./fixtures";

const emptyBoard = (): Board => deepFreeze({ cols: 5, rows: 5, items: [] });

const boardOf = (): Board => deepFreeze(midGameState().board);

describe("neighbors", () => {
  it("lists the eight touching cells of a middle cell, row-major", () => {
    expect(neighbors(emptyBoard(), "c2_2")).toEqual([
      "c1_1",
      "c2_1",
      "c3_1",
      "c1_2",
      "c3_2",
      "c1_3",
      "c2_3",
      "c3_3"
    ]);
  });

  it("clips the ring at the top-left corner", () => {
    expect(neighbors(emptyBoard(), "c0_0")).toEqual(["c1_0", "c0_1", "c1_1"]);
  });

  it("clips the ring at the bottom-right corner", () => {
    expect(neighbors(emptyBoard(), "c4_4")).toEqual(["c3_3", "c4_3", "c3_4"]);
  });

  it("never returns the cell itself", () => {
    expect(neighbors(emptyBoard(), "c1_1")).not.toContain("c1_1");
  });

  it("returns nothing for an address that is not a cell", () => {
    expect(neighbors(emptyBoard(), "nowhere")).toEqual([]);
  });

  it("returns nothing for a cell whose parts are not integers", () => {
    expect(neighbors(emptyBoard(), "cx_1")).toEqual([]);
    expect(neighbors(emptyBoard(), "c_1")).toEqual([]);
    expect(neighbors(emptyBoard(), "c1")).toEqual([]);
  });
});

describe("findFreeCell", () => {
  it("scans row-major from the top-left when no anchor is given", () => {
    expect(findFreeCell(emptyBoard())).toBe("c0_0");
  });

  it("skips the occupied first row", () => {
    expect(findFreeCell(boardOf())).toBe("c0_1");
  });

  it("returns the anchor itself when it is free", () => {
    expect(findFreeCell(boardOf(), "c3_3")).toBe("c3_3");
  });

  it("scans the nearest ring first, row-major inside the ring", () => {
    const board = deepFreeze({
      cols: 5,
      rows: 5,
      items: [
        { id: "a", chain: "wood", level: 1, cell: "c2_2" },
        { id: "b", chain: "wood", level: 1, cell: "c1_1" }
      ]
    });

    expect(findFreeCell(board, "c2_2")).toBe("c2_1");
  });

  it("widens to the next ring when the first ring is full", () => {
    const taken = new Set(["c2_2", "c1_1", "c2_1", "c3_1", "c1_2", "c3_2", "c1_3", "c2_3", "c3_3"]);
    const board = deepFreeze({
      cols: 5,
      rows: 5,
      items: [...taken].map((cell, index) => ({
        id: `t${index}`,
        chain: "wood",
        level: 1,
        cell
      }))
    });

    expect(findFreeCell(board, "c2_2")).toBe("c0_0");
  });

  it("still finds a cell when the anchor lies outside the board", () => {
    expect(findFreeCell(emptyBoard(), "c9_9")).toBe("c4_4");
  });

  it("falls back to row-major when the anchor is not a cell address", () => {
    expect(findFreeCell(boardOf(), "nowhere")).toBe("c0_1");
  });

  it("returns undefined when the board is full", () => {
    const board = deepFreeze({ cols: 5, rows: 5, items: filledItems(5, 5) });

    expect(findFreeCell(board)).toBeUndefined();
    expect(findFreeCell(board, "c2_2")).toBeUndefined();
  });
});

describe("itemAt", () => {
  it("returns the item standing on a cell", () => {
    expect(itemAt(boardOf(), "c2_0")?.id).toBe("i3");
  });

  it("returns undefined for an empty cell", () => {
    expect(itemAt(boardOf(), "c2_2")).toBeUndefined();
  });
});

describe("itemById", () => {
  it("returns the item with that id", () => {
    expect(itemById(boardOf(), "i4")?.cell).toBe("c3_0");
  });

  it("returns undefined for an unknown id", () => {
    expect(itemById(boardOf(), "i99")).toBeUndefined();
  });
});

describe("withoutItem", () => {
  it("drops the item and leaves the input board untouched", () => {
    const board = boardOf();
    const next = withoutItem(board, "i1");

    expect(next.items.map(item => item.id)).toEqual(["i2", "i3", "i4", "i5"]);
    expect(board.items).toHaveLength(5);
  });

  it("returns an equal board for an unknown id", () => {
    expect(withoutItem(boardOf(), "i99").items).toHaveLength(5);
  });
});

describe("withItem", () => {
  it("appends the item without touching the input board", () => {
    const board = boardOf();
    const next = withItem(board, { id: "i6", chain: "wood", level: 1, cell: "c0_1" });

    expect(next.items.at(-1)?.id).toBe("i6");
    expect(board.items).toHaveLength(5);
  });
});

describe("replaceItem", () => {
  it("replaces the item of the same id in place", () => {
    const board = boardOf();
    const next = replaceItem(board, { id: "i3", chain: "wood", level: 3, cell: "c2_0" });

    expect(next.items[2]).toEqual({ id: "i3", chain: "wood", level: 3, cell: "c2_0" });
    expect(board.items[2]?.level).toBe(2);
  });
});
